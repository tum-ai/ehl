import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression tests for three dashboard/admin data bugs:
// 1. getTeamMatchHistory selected a non-existent submissions.created_at column
//    (the table has submitted_at), so the error was silently discarded and the
//    match history showed "No submission" for every match.
// 2. getPendingInvitesForTeam used the anon client against team_invites, whose
//    RLS policies all require auth.uid() — the president always saw [].
// 3. getAllParticipantsWithTeams crashed on a profile with a null email (the
//    00055 trigger inserts email-less profiles on UNIQUE collision).
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createServerClient }));

import {
  getTeamMatchHistory,
  getPendingInvitesForTeam,
  getAllParticipantsWithTeams,
} from "@/lib/queries/teams";

/** Thenable query stub: awaiting it (at any point in the chain) resolves to
 *  { data }, and all common builder methods return the same thenable. */
function queryReturning(data: unknown) {
  const p: Record<string, unknown> = {};
  const promise = Promise.resolve({ data, error: null });
  for (const m of ["eq", "neq", "order", "limit", "select"]) {
    p[m] = () => p;
  }
  p.then = promise.then.bind(promise);
  p.catch = promise.catch.bind(promise);
  return p;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getTeamMatchHistory", () => {
  it("selects submitted_at (not the non-existent created_at) and maps it", async () => {
    const selects: Record<string, string> = {};
    const rows: Record<string, unknown[]> = {
      challenge_registrations: [
        { chapter_id: "ch1", challenge_id: "cl1", team_id: "t1", roster: [], registered_at: "2026-05-10T09:00:00+00:00" },
      ],
      scores: [],
      submissions: [
        { challenge_id: "cl1", team_id: "t1", project_name: "Proj X", submitted_at: "2026-05-15T10:00:00+00:00" },
      ],
      chapters: [
        { id: "ch1", name: "Match 1", slug: "match-1", date: "2026-05-15", city: "Munich", status: "completed" },
      ],
      challenges: [{ id: "cl1", title: "Challenge A", chapter_id: "ch1" }],
    };
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => ({
        select: (cols: string) => {
          selects[table] = cols;
          return queryReturning(rows[table] ?? []);
        },
      }),
    });

    const history = await getTeamMatchHistory("t1");

    expect(selects.submissions).toContain("submitted_at");
    expect(selects.submissions).not.toContain("created_at");
    expect(history).toHaveLength(1);
    expect(history[0].submission).toEqual({
      projectName: "Proj X",
      createdAt: "2026-05-15T10:00:00+00:00",
    });
  });
});

describe("getPendingInvitesForTeam", () => {
  it("uses the authenticated server client (RLS requires auth.uid()) and maps rows", async () => {
    const invite = {
      id: "i1",
      team_id: "t1",
      email: "invitee@example.com",
      name: "Invitee",
      invited_by: "u1",
      status: "pending",
      token: "tok",
      created_at: "2026-05-01T00:00:00+00:00",
      expires_at: "2026-05-08T00:00:00+00:00",
    };
    mocks.createServerClient.mockResolvedValue({
      from: () => ({ select: () => queryReturning([invite]) }),
    });

    const invites = await getPendingInvitesForTeam("t1");

    expect(mocks.createServerClient).toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe("invitee@example.com");
    expect(invites[0].status).toBe("pending");
  });
});

describe("getAllParticipantsWithTeams", () => {
  it("does not crash on a profile with a null email", async () => {
    const rows: Record<string, unknown[]> = {
      profiles: [
        { id: "u1", email: "a@example.com", name: "A" },
        { id: "u2", email: null, name: "No Email" },
      ],
      team_members: [],
    };
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => ({ select: () => queryReturning(rows[table] ?? []) }),
    });

    const participants = await getAllParticipantsWithTeams();

    expect(participants).toHaveLength(2);
    expect(participants[1]).toMatchObject({ id: "u2", email: "", checkedIn: false });
  });
});
