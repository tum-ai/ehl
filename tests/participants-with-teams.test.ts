import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getAllParticipantsWithTeams backs the admin Teams page ("Participants" tab).
 *
 * It is the non-`.single()` member of the multi-row class (CLAUDE.md Data
 * Integrity 7): it built its user -> team map with `Map.set()` in a loop, so a
 * user holding several team_members rows was shown under whichever row
 * PostgREST returned LAST, frequently a team from a chapter that had already
 * finished. Admins then moved or removed people from the wrong roster.
 */

const state = {
  profiles: [] as { id: string; email: string; name: string | null }[],
  memberships: [] as {
    user_id: string;
    team_id: string;
    role: string;
    joined_at: string | null;
    teams: { name: string; slug: string };
  }[],
  registrations: [] as { team_id: string; status: string }[],
  applications: [] as { email: string; status: string; checked_in_at: string | null }[],
};

/** PostgREST's server-side ceiling; see supabase/config.toml `max_rows`. */
const SERVER_MAX_ROWS = 1000;

function fakeAdminClient() {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const rows = (): unknown[] => {
      if (table === "profiles") return state.profiles;
      if (table === "team_members") return state.memberships;
      if (table === "challenge_registrations") {
        const wanted = (filters["team_id__in"] as string[]) ?? [];
        return state.registrations
          .filter((r) => wanted.includes(r.team_id))
          .map((r) => ({ team_id: r.team_id, chapters: { status: r.status } }));
      }
      if (table === "applications") return state.applications;
      return [];
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters[`${col}__in`] = vals;
        return builder;
      },
      order: () => builder,
      // PostgREST applies max_rows to .limit() too: asking for 25000 returns
      // 1000 and says nothing. The mock must reproduce that, otherwise a test
      // suite "passes" against exactly the code that shipped the bug.
      limit: (n: number) =>
        Promise.resolve({
          data: rows().slice(0, Math.min(n ?? SERVER_MAX_ROWS, SERVER_MAX_ROWS)),
          error: null,
        }),
      // The queries page with .range() now, because PostgREST caps every
      // response at max_rows (1000) server-side and .limit() cannot exceed it.
      // This mock enforces the SAME cap, so a query that stopped paging would
      // fail here exactly as it did in production.
      range: (from: number, to: number) => {
        const all = rows();
        const requested = to - from + 1;
        const capped = Math.min(requested, SERVER_MAX_ROWS);
        return Promise.resolve({ data: all.slice(from, from + capped), error: null });
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows().slice(0, SERVER_MAX_ROWS), error: null }).then(
          resolve,
          reject
        ),
    };
    return builder;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeAdminClient(),
}));

import {
  getAllParticipantsWithTeams,
  getAllParticipantsWithTeamsPaged,
} from "@/lib/queries/teams";
import { QUERY_LIMITS } from "@/lib/config/limits";

const OLD_TEAM = { name: "Old Guard", slug: "old-guard" };
const NEW_TEAM = { name: "Current Crew", slug: "current-crew" };

beforeEach(() => {
  state.profiles = [{ id: "u1", email: "Ada@Example.com", name: "Ada" }];
  state.memberships = [];
  state.registrations = [];
  state.applications = [];
});

describe("getAllParticipantsWithTeams", () => {
  it("shows the ACTIVE-chapter team for a user with two memberships", async () => {
    // The historical membership is listed last, which is exactly the ordering
    // that made last-write-wins pick the wrong team.
    state.memberships = [
      { user_id: "u1", team_id: "t-new", role: "president", joined_at: "2026-08-01T00:00:00Z", teams: NEW_TEAM },
      { user_id: "u1", team_id: "t-old", role: "member", joined_at: "2026-05-01T00:00:00Z", teams: OLD_TEAM },
    ];
    state.registrations = [
      { team_id: "t-new", status: "hacking" },
      { team_id: "t-old", status: "completed" },
    ];

    const [p] = await getAllParticipantsWithTeams();
    expect(p.teamId).toBe("t-new");
    expect(p.teamName).toBe("Current Crew");
    expect(p.teamSlug).toBe("current-crew");
    expect(p.teamRole).toBe("president");
  });

  it("falls back to the most recently joined team when no chapter is active", async () => {
    state.memberships = [
      { user_id: "u1", team_id: "t-new", role: "member", joined_at: "2026-08-01T00:00:00Z", teams: NEW_TEAM },
      { user_id: "u1", team_id: "t-old", role: "president", joined_at: "2026-05-01T00:00:00Z", teams: OLD_TEAM },
    ];
    state.registrations = [
      { team_id: "t-new", status: "completed" },
      { team_id: "t-old", status: "completed" },
    ];

    const [p] = await getAllParticipantsWithTeams();
    expect(p.teamId).toBe("t-new");
    expect(p.teamRole).toBe("member");
  });

  it("is not sensitive to the order the membership rows arrive in", async () => {
    const rows = [
      { user_id: "u1", team_id: "t-old", role: "member" as const, joined_at: "2026-05-01T00:00:00Z", teams: OLD_TEAM },
      { user_id: "u1", team_id: "t-new", role: "president" as const, joined_at: "2026-08-01T00:00:00Z", teams: NEW_TEAM },
    ];
    state.registrations = [
      { team_id: "t-new", status: "submissions_open" },
      { team_id: "t-old", status: "completed" },
    ];

    state.memberships = [...rows];
    const forward = await getAllParticipantsWithTeams();
    state.memberships = [...rows].reverse();
    const reversed = await getAllParticipantsWithTeams();

    expect(forward[0].teamId).toBe("t-new");
    expect(reversed[0].teamId).toBe("t-new");
  });

  it("reports no team for a participant who has none", async () => {
    const [p] = await getAllParticipantsWithTeams();
    expect(p.teamId).toBeNull();
    expect(p.teamName).toBeNull();
    expect(p.teamRole).toBeNull();
  });

  it("keeps single-membership users on their one team", async () => {
    state.memberships = [
      { user_id: "u1", team_id: "t-old", role: "member", joined_at: null, teams: OLD_TEAM },
    ];
    const [p] = await getAllParticipantsWithTeams();
    expect(p.teamId).toBe("t-old");
    expect(p.teamName).toBe("Old Guard");
  });

  it("matches check-in case-insensitively on email", async () => {
    state.applications = [
      { email: "ada@example.com", status: "checked_in", checked_in_at: "2026-08-23T09:00:00Z" },
    ];
    const [p] = await getAllParticipantsWithTeams("chapter-1");
    expect(p.email).toBe("ada@example.com");
    expect(p.checkedIn).toBe(true);
    expect(p.checkedInAt).toBe("2026-08-23T09:00:00Z");
  });
});

/**
 * The regression this suite previously could not see.
 *
 * Every fixture above is a handful of rows, so the query "worked" while a plain
 * .limit(25000) was silently capped at 1000 by PostgREST server-side. The admin
 * Teams page showed exactly 1000 participants and, because LimitBanner compared
 * 1000 against the configured 25000, said nothing at all.
 */
describe("getAllParticipantsWithTeams past the server-side row ceiling", () => {
  function seedParticipants(n: number) {
    state.profiles = Array.from({ length: n }, (_, i) => ({
      id: `u${i}`,
      email: `p${String(i).padStart(5, "0")}@example.com`,
      name: `Person ${i}`,
    }));
  }

  it("returns MORE than the 1000-row server cap", async () => {
    seedParticipants(2500);
    const people = await getAllParticipantsWithTeams();
    expect(people.length).toBe(2500);
  });

  it("does not stop at exactly 1000", async () => {
    seedParticipants(1001);
    const people = await getAllParticipantsWithTeams();
    expect(people.length).not.toBe(1000);
    expect(people.length).toBe(1001);
  });

  it("preserves order across page boundaries, with no gaps or repeats", async () => {
    seedParticipants(2500);
    const people = await getAllParticipantsWithTeams();
    expect(people[0].email).toBe("p00000@example.com");
    expect(people[999].email).toBe("p00999@example.com");
    // The row straddling the first page boundary is the one a broken loop drops.
    expect(people[1000].email).toBe("p01000@example.com");
    expect(people[2499].email).toBe("p02499@example.com");
    expect(new Set(people.map((p) => p.id)).size).toBe(2500);
  });

  it("reports truncated=false when the data simply ends", async () => {
    seedParticipants(1500);
    const { rows, truncated } = await getAllParticipantsWithTeamsPaged();
    expect(rows.length).toBe(1500);
    expect(truncated).toBe(false);
  });

  it("reports truncated=true when rows are left unread beyond the limit", async () => {
    // One row past the configured participants limit.
    seedParticipants(QUERY_LIMITS.participants + 1);
    const { rows, truncated } = await getAllParticipantsWithTeamsPaged();
    expect(rows.length).toBe(QUERY_LIMITS.participants);
    expect(truncated).toBe(true);
  });

  it("handles an exact multiple of the page size without a phantom extra page", async () => {
    seedParticipants(2000);
    const { rows, truncated } = await getAllParticipantsWithTeamsPaged();
    expect(rows.length).toBe(2000);
    expect(truncated).toBe(false);
  });
});
