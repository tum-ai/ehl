import { describe, it, expect, vi, beforeEach } from "vitest";

// A user can hold several team_members rows: migration 00024 dropped the global
// unique index on team_members(user_id) so rosters can change between chapters,
// and the 00035 trigger only blocks a second team while the first is registered
// for a non-completed chapter. Every lookup that used `.single()` on user_id
// therefore returned NOTHING for anyone who had ever changed teams (PostgREST
// rejects a multi-row result), which is what emptied their dashboard.

import {
  pickCurrentMembership,
  getCurrentMembership,
  getLockingTeamId,
  type MembershipRow,
} from "@/lib/team-membership";

const OLD: MembershipRow = {
  teamId: "team-old",
  role: "member",
  joinedAt: "2026-05-26T17:16:11.000Z",
};
const NEW: MembershipRow = {
  teamId: "team-new",
  role: "member",
  joinedAt: "2026-08-22T11:47:41.000Z",
};

// ─── Fake Supabase client ────────────────────────────────────────────────

type FakeState = {
  memberships: { team_id: string; role: string; joined_at: string | null }[];
  /** One challenge registration per team, with the status of its chapter */
  registrations: {
    team_id: string;
    status: string;
    chapter_id?: string;
    challenge_title?: string;
  }[];
  teams: Record<string, Record<string, unknown>>;
  /** Rows for the tables getEventStatus reads before it looks at memberships */
  profile: Record<string, unknown> | null;
  application: Record<string, unknown> | null;
  chapter: Record<string, unknown> | null;
  deletes: { table: string; filters: Record<string, unknown> }[];
  queries: string[];
};

function makeState(partial: Partial<FakeState> = {}): FakeState {
  return {
    memberships: [],
    registrations: [],
    teams: {},
    profile: null,
    application: null,
    chapter: null,
    deletes: [],
    queries: [],
    ...partial,
  };
}

/** Minimal PostgREST-shaped stub covering the chains these helpers build. */
function fakeClient(state: FakeState) {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let isDelete = false;

    const rows = (): unknown[] => {
      if (table === "team_members") {
        return state.memberships;
      }
      if (table === "challenge_registrations") {
        if (filters["team_id__in"]) {
          // The active-chapter lookup: which of these teams are still competing
          const wanted = filters["team_id__in"] as string[];
          return state.registrations
            .filter((r) => wanted.includes(r.team_id))
            .map((r) => ({ team_id: r.team_id, chapters: { status: r.status } }));
        }
        // The event-hub lookup: this team's registration for this chapter
        return state.registrations
          .filter(
            (r) =>
              r.team_id === filters["team_id"] &&
              r.chapter_id === filters["chapter_id"]
          )
          .map((r) => ({
            id: `reg-${r.team_id}`,
            challenge_id: "challenge-1",
            team_id: r.team_id,
            roster: [],
            registered_at: r.chapter_id,
            challenges: { title: r.challenge_title ?? "A challenge" },
          }));
      }
      if (table === "teams") {
        const row = state.teams[filters["id"] as string];
        return row ? [row] : [];
      }
      if (table === "profiles") return state.profile ? [state.profile] : [];
      if (table === "applications") return state.application ? [state.application] : [];
      if (table === "chapters") return state.chapter ? [state.chapter] : [];
      if (table === "team_join_requests") return [];
      return [];
    };

    const settle = (single: boolean) => {
      if (isDelete) {
        state.deletes.push({ table, filters: { ...filters } });
        return { data: null, error: null };
      }
      const result = rows();
      if (single) {
        // PostgREST fails a `.single()` that does not match exactly one row.
        if (result.length !== 1) {
          return { data: null, error: { code: "PGRST116", message: "not one row" } };
        }
        return { data: result[0], error: null };
      }
      return { data: result, error: null };
    };

    const builder: Record<string, unknown> = {
      select: (cols?: string) => {
        state.queries.push(`${table}:${cols ?? "*"}`);
        return builder;
      },
      delete: () => {
        isDelete = true;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters[`${col}__in`] = vals;
        return builder;
      },
      limit: () => builder,
      single: () => Promise.resolve(settle(true)),
      maybeSingle: () => Promise.resolve(settle(true)),
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(settle(false)).then(resolve, reject),
    };
    return builder;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

// ─── pickCurrentMembership (pure) ────────────────────────────────────────

describe("pickCurrentMembership", () => {
  it("returns null when the user is on no team", () => {
    expect(pickCurrentMembership([], new Set())).toBeNull();
  });

  it("returns the only membership when there is exactly one", () => {
    expect(pickCurrentMembership([OLD], new Set())).toEqual(OLD);
  });

  it("prefers the team registered for an active chapter over the newer one", () => {
    // The whole point: recency is a fallback, the live chapter wins.
    const picked = pickCurrentMembership([OLD, NEW], new Set(["team-old"]));
    expect(picked).toEqual(OLD);
  });

  it("falls back to the most recently joined team when none is active", () => {
    expect(pickCurrentMembership([OLD, NEW], new Set())).toEqual(NEW);
    // Row order must not matter.
    expect(pickCurrentMembership([NEW, OLD], new Set())).toEqual(NEW);
  });

  it("picks the newest among several active teams", () => {
    const picked = pickCurrentMembership(
      [OLD, NEW],
      new Set(["team-old", "team-new"])
    );
    expect(picked).toEqual(NEW);
  });

  it("treats a missing joined_at as the oldest membership", () => {
    const undated: MembershipRow = { teamId: "team-undated", role: "member", joinedAt: null };
    expect(pickCurrentMembership([undated, OLD], new Set())).toEqual(OLD);
  });

  it("breaks an exact joined_at tie on team id, so the result is stable", () => {
    const a: MembershipRow = { teamId: "team-a", role: "member", joinedAt: NEW.joinedAt };
    const b: MembershipRow = { teamId: "team-b", role: "president", joinedAt: NEW.joinedAt };
    expect(pickCurrentMembership([b, a], new Set())).toEqual(a);
    expect(pickCurrentMembership([a, b], new Set())).toEqual(a);
  });

  it("keeps the role of the membership it picks", () => {
    const president: MembershipRow = { ...OLD, role: "president" };
    const picked = pickCurrentMembership([president, NEW], new Set(["team-old"]));
    expect(picked?.role).toBe("president");
  });
});

// ─── getCurrentMembership (against the fake client) ──────────────────────

describe("getCurrentMembership", () => {
  it("resolves the active-chapter team when the user holds two memberships", async () => {
    // Regression: this is the exact production shape (an old team from a
    // completed chapter plus the team of the running chapter). The previous
    // `.single()` lookup returned null here and the dashboard showed no team.
    const state = makeState({
      memberships: [
        { team_id: "team-old", role: "member", joined_at: OLD.joinedAt },
        { team_id: "team-new", role: "member", joined_at: NEW.joinedAt },
      ],
      registrations: [
        { team_id: "team-old", status: "completed" },
        { team_id: "team-new", status: "pitching" },
      ],
    });

    const membership = await getCurrentMembership(fakeClient(state), "user-1");
    expect(membership).toEqual({
      teamId: "team-new",
      role: "member",
      joinedAt: NEW.joinedAt,
    });
  });

  it("returns null when the user is on no team", async () => {
    const state = makeState();
    expect(await getCurrentMembership(fakeClient(state), "user-1")).toBeNull();
  });

  it("skips the chapter lookup entirely for a single membership", async () => {
    const state = makeState({
      memberships: [{ team_id: "team-new", role: "president", joined_at: NEW.joinedAt }],
    });

    const membership = await getCurrentMembership(fakeClient(state), "user-1");
    expect(membership?.teamId).toBe("team-new");
    expect(state.queries.some((q) => q.startsWith("challenge_registrations"))).toBe(false);
  });

  it("falls back to the newest team when every chapter has completed", async () => {
    const state = makeState({
      memberships: [
        { team_id: "team-old", role: "member", joined_at: OLD.joinedAt },
        { team_id: "team-new", role: "member", joined_at: NEW.joinedAt },
      ],
      registrations: [
        { team_id: "team-old", status: "completed" },
        { team_id: "team-new", status: "completed" },
      ],
    });

    const membership = await getCurrentMembership(fakeClient(state), "user-1");
    expect(membership?.teamId).toBe("team-new");
  });
});

// ─── getLockingTeamId ────────────────────────────────────────────────────

describe("getLockingTeamId", () => {
  it("locks on ANY membership with an active chapter, not just the current one", async () => {
    // The older team is the one still competing. Checking only the newest
    // membership would let the user walk away from an active chapter.
    const state = makeState({
      memberships: [
        { team_id: "team-old", role: "member", joined_at: OLD.joinedAt },
        { team_id: "team-new", role: "member", joined_at: NEW.joinedAt },
      ],
      registrations: [
        { team_id: "team-old", status: "hacking" },
        { team_id: "team-new", status: "completed" },
      ],
    });

    expect(await getLockingTeamId(fakeClient(state), "user-1")).toBe("team-old");
  });

  it("does not lock when every registration is for a completed chapter", async () => {
    const state = makeState({
      memberships: [{ team_id: "team-old", role: "member", joined_at: OLD.joinedAt }],
      registrations: [{ team_id: "team-old", status: "completed" }],
    });

    expect(await getLockingTeamId(fakeClient(state), "user-1")).toBeNull();
  });

  it("does not lock a user who is on no team", async () => {
    expect(await getLockingTeamId(fakeClient(makeState()), "user-1")).toBeNull();
  });

  // inviteJury (lib/actions/auth.ts) refuses anyone who is an ACTIVE team
  // member. It used to read that with `.limit(1).single()` on user_id, which
  // picked an arbitrary row, so a person whose only membership sat on a
  // finished chapter was barred from ever serving as jury. getLockingTeamId is
  // now the single source of truth for "active team member".
  it("does not treat a purely historical membership as an active team member", async () => {
    const state = makeState({
      memberships: [
        { team_id: "team-old", role: "president", joined_at: OLD.joinedAt },
        { team_id: "team-older", role: "member", joined_at: "2026-01-04T09:00:00.000Z" },
      ],
      registrations: [
        { team_id: "team-old", status: "completed" },
        { team_id: "team-older", status: "completed" },
      ],
    });

    expect(await getLockingTeamId(fakeClient(state), "user-1")).toBeNull();
  });

  it("still treats a user with one active and one finished team as active", async () => {
    const state = makeState({
      memberships: [
        { team_id: "team-old", role: "member", joined_at: OLD.joinedAt },
        { team_id: "team-new", role: "member", joined_at: NEW.joinedAt },
      ],
      registrations: [
        { team_id: "team-old", status: "completed" },
        { team_id: "team-new", status: "hacking" },
      ],
    });

    expect(await getLockingTeamId(fakeClient(state), "user-1")).toBe("team-new");
  });

  it("does not lock a team that has no challenge registration at all", async () => {
    const state = makeState({
      memberships: [{ team_id: "team-new", role: "member", joined_at: NEW.joinedAt }],
    });

    expect(await getLockingTeamId(fakeClient(state), "user-1")).toBeNull();
  });
});

// ─── The user-visible paths ──────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createServerClient }));
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: vi.fn() }));
vi.mock("@/lib/event-log", () => ({ logEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getTeamForUser } from "@/lib/queries/teams";
import { leaveTeam } from "@/lib/actions/teams";
import { getEventStatus } from "@/lib/actions/event";

const TWO_TEAM_STATE = () =>
  makeState({
    memberships: [
      { team_id: "team-old", role: "member", joined_at: OLD.joinedAt },
      { team_id: "team-new", role: "member", joined_at: NEW.joinedAt },
    ],
    registrations: [
      { team_id: "team-old", status: "completed" },
      { team_id: "team-new", status: "pitching" },
    ],
    teams: {
      "team-new": {
        id: "team-new",
        name: "IHSG",
        slug: "ihsg",
        university: "TUM",
        city: "Munich",
        status: "active",
        president_user_id: "user-2",
        looking_for_members: false,
        created_at: NEW.joinedAt,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  });
});

describe("getTeamForUser", () => {
  it("returns the current team for a user who also has an old membership", async () => {
    // The dashboard bug: two rows made `.single()` fail and the participant was
    // told they had no team while sitting in a team for the running chapter.
    mocks.createAdminClient.mockReturnValue(fakeClient(TWO_TEAM_STATE()));

    const result = await getTeamForUser("user-1");
    expect(result?.team.name).toBe("IHSG");
    expect(result?.role).toBe("member");
  });

  it("returns null for a user with no membership at all", async () => {
    mocks.createAdminClient.mockReturnValue(fakeClient(makeState()));
    expect(await getTeamForUser("user-1")).toBeNull();
  });
});

describe("getEventStatus", () => {
  const CHAPTER = "chapter-live";

  function eventState() {
    const state = TWO_TEAM_STATE();
    state.profile = { email: "participant@example.com" };
    state.application = { id: "app-1", status: "checked_in" };
    state.chapter = {
      id: CHAPTER,
      name: "Munich",
      challenge_registration_enabled: true,
    };
    state.registrations = [
      { team_id: "team-old", status: "completed", chapter_id: "chapter-past" },
      {
        team_id: "team-new",
        status: "pitching",
        chapter_id: CHAPTER,
        challenge_title: "Build something",
      },
    ];
    state.teams["team-old"] = { id: "team-old", name: "defaultTeam02" };
    return state;
  }

  it("shows the team of the running chapter, not an older one", async () => {
    // Picking an arbitrary membership row could surface the old team here and,
    // worse, look up the challenge registration for the wrong team.
    mocks.createAdminClient.mockReturnValue(fakeClient(eventState()));

    const result = await getEventStatus(CHAPTER);
    expect(result.error).toBeUndefined();
    expect(result.team).toEqual({ id: "team-new", name: "IHSG", isPresident: false });
    expect(result.challengeRegistration?.teamId).toBe("team-new");
    expect(result.challengeRegistration?.challengeTitle).toBe("Build something");
  });

  it("reports no team for a checked-in participant who has none", async () => {
    const state = eventState();
    state.memberships = [];
    mocks.createAdminClient.mockReturnValue(fakeClient(state));

    const result = await getEventStatus(CHAPTER);
    expect(result.team).toBeNull();
    expect(result.challengeRegistration).toBeNull();
  });
});

describe("leaveTeam", () => {
  it("refuses while the current team is registered for an active chapter", async () => {
    mocks.createAdminClient.mockReturnValue(fakeClient(TWO_TEAM_STATE()));

    const result = await leaveTeam();
    expect(result).toEqual({
      error: "You cannot change teams while your current team is registered for an active chapter.",
    });
  });

  it("leaves the CURRENT team, not the historical one, once no chapter is active", async () => {
    const state = TWO_TEAM_STATE();
    state.registrations = [
      { team_id: "team-old", status: "completed" },
      { team_id: "team-new", status: "completed" },
    ];
    mocks.createAdminClient.mockReturnValue(fakeClient(state));

    const result = await leaveTeam();
    expect(result).toEqual({ success: true });
    expect(state.deletes).toEqual([
      { table: "team_members", filters: { team_id: "team-new", user_id: "user-1" } },
    ]);
  });

  it("still reports no team when the user really has none", async () => {
    mocks.createAdminClient.mockReturnValue(fakeClient(makeState()));
    expect(await leaveTeam()).toEqual({ error: "You are not on a team." });
  });
});
