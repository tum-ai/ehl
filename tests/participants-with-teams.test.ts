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
      limit: () => Promise.resolve({ data: rows(), error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
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

import { getAllParticipantsWithTeams } from "@/lib/queries/teams";

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
