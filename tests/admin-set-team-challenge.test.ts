import { describe, it, expect, vi, beforeEach } from "vitest";

// adminSetTeamChallenge lets an admin assign or change a team's challenge for a
// chapter, but ONLY while submissions are still open. We verify: the authz gate,
// the submissions-open gate (status + deadline), team/challenge belong to the
// chapter, assign-vs-change upsert (no duplicate), the existing-submission block
// on a change, and that an audit entry is written.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: mocks.logEventStrict,
}));
// sendEmail / certificate rendering are imported by admin.ts; stub to keep the
// module graph light and side-effect free.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/emails/render", () => ({ renderCertificateEmail: vi.fn() }));

import { adminSetTeamChallenge } from "@/lib/actions/admin";

const CHAPTER = "chapter-a";
const TEAM = "team-1";
const CHALLENGE_A = "challenge-a";
const CHALLENGE_B = "challenge-b";
const CALLER = "caller-admin";

interface CallState {
  table: string;
  op: string;
  filters: [string, unknown][];
  payload: unknown;
}

// Minimal chainable Supabase mock. `responder(state)` returns the result for a
// given table/op/filters; every terminal call is recorded in `calls`.
function makeAdminClient(opts: {
  responder: (s: CallState) => unknown;
  calls: CallState[];
}) {
  function makeBuilder() {
    const state: CallState = {
      table: "",
      op: "select",
      filters: [],
      payload: null,
    };
    const resolve = () => {
      opts.calls.push({ ...state, filters: [...state.filters] });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: (_c?: unknown, _o?: unknown) => ((state.op = "select"), builder),
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      order: () => builder,
      limit: () => builder,
      single: () => resolve(),
      maybeSingle: () => resolve(),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        resolve().then(onF, onR),
    };
    return { builder, state };
  }

  return {
    from(table: string) {
      const { builder, state } = makeBuilder();
      state.table = table;
      return builder;
    },
  };
}

/**
 * Default responder: open chapter, valid team in chapter, valid challenge,
 * no existing registration, no submissions. Override pieces per test.
 */
function defaultResponder(overrides: Partial<{
  chapter: unknown;
  team: unknown;
  members: unknown;
  profiles: unknown;
  application: unknown;
  challenge: unknown;
  registration: unknown;
  submission: unknown;
}> = {}) {
  const o = {
    chapter: { data: { status: "submissions_open", submission_deadline: null } },
    team: { data: { id: TEAM, name: "Team One" } },
    members: { data: [{ user_id: "u1" }, { user_id: "u2" }] },
    profiles: { data: [{ email: "a@x.com" }, { email: "b@x.com" }] },
    application: { data: { id: "app-1" } },
    challenge: { data: { id: CHALLENGE_A, title: "Challenge A" } },
    registration: { data: null },
    submission: { data: null },
    ...overrides,
  };
  return ({ table, op }: CallState) => {
    if (table === "chapters" && op === "select") return o.chapter;
    if (table === "teams" && op === "select") return o.team;
    if (table === "team_members" && op === "select") return o.members;
    if (table === "profiles" && op === "select") return o.profiles;
    if (table === "applications" && op === "select") return o.application;
    if (table === "challenges" && op === "select") return o.challenge;
    if (table === "challenge_registrations" && op === "select") return o.registration;
    if (table === "submissions" && op === "select") return o.submission;
    // writes
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.logEventStrict.mockResolvedValue(undefined);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: CALLER } } }) },
  });
});

describe("adminSetTeamChallenge", () => {
  it("rejects a non-admin caller before touching the DB", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("requires team, challenge, and chapter ids", async () => {
    const result = await adminSetTeamChallenge("", CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/required/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("assigns a challenge when the team has none (inserts, audit-logged)", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: defaultResponder() })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result).toEqual({ success: true });

    const insert = calls.find(
      (c) => c.table === "challenge_registrations" && c.op === "insert"
    );
    expect(insert?.payload).toMatchObject({
      chapter_id: CHAPTER,
      challenge_id: CHALLENGE_A,
      team_id: TEAM,
    });
    // roster seeded from team members
    expect((insert?.payload as { roster: string[] }).roster).toEqual(["u1", "u2"]);

    // No update path on an assign.
    expect(
      calls.find((c) => c.table === "challenge_registrations" && c.op === "update")
    ).toBeUndefined();

    expect(mocks.logEventStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "challenge_registration.admin_override",
        delta: expect.objectContaining({
          challenge: { from: null, to: CHALLENGE_A },
        }),
      })
    );
  });

  it("changes an existing challenge by UPDATING the row (no duplicate insert)", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          challenge: { data: { id: CHALLENGE_B, title: "Challenge B" } },
          registration: { data: { id: "reg-1", challenge_id: CHALLENGE_A, roster: ["u1"] } },
          submission: { data: null },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_B, CHAPTER);
    expect(result).toEqual({ success: true });

    const update = calls.find(
      (c) => c.table === "challenge_registrations" && c.op === "update"
    );
    expect((update?.payload as { challenge_id: string }).challenge_id).toBe(CHALLENGE_B);
    expect(update?.filters).toContainEqual(["id", "reg-1"]);

    // Must NOT insert a new registration on a change.
    expect(
      calls.find((c) => c.table === "challenge_registrations" && c.op === "insert")
    ).toBeUndefined();

    expect(mocks.logEventStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: expect.objectContaining({
          challenge: { from: CHALLENGE_A, to: CHALLENGE_B },
        }),
      })
    );
  });

  it("REJECTS when the chapter has moved past submissions (status gate)", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          chapter: { data: { status: "pitching", submission_deadline: null } },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/submissions are closed/i);
    expect(
      calls.find((c) => c.table === "challenge_registrations" && c.op === "insert")
    ).toBeUndefined();
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });

  it("REJECTS when the submission deadline has already passed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          chapter: { data: { status: "submissions_open", submission_deadline: past } },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/deadline has passed/i);
    expect(
      calls.find((c) => c.table === "challenge_registrations")
    ).toBeUndefined();
  });

  it("allows the override before a future submission deadline", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          chapter: { data: { status: "hacking", submission_deadline: future } },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result).toEqual({ success: true });
  });

  it("rejects when the team is not part of the chapter", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({ application: { data: null } }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/not part of this chapter/i);
    expect(
      calls.find((c) => c.table === "challenge_registrations" && c.op === "insert")
    ).toBeUndefined();
  });

  it("rejects when the challenge does not belong to the chapter", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({ challenge: { data: null } }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/does not belong to this chapter/i);
  });

  it("blocks a change when the team already submitted to its current challenge", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          challenge: { data: { id: CHALLENGE_B, title: "Challenge B" } },
          registration: { data: { id: "reg-1", challenge_id: CHALLENGE_A, roster: [] } },
          submission: { data: { id: "sub-1" } },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_B, CHAPTER);
    expect(result.error).toMatch(/already submitted/i);
    expect(
      calls.find((c) => c.table === "challenge_registrations" && c.op === "update")
    ).toBeUndefined();
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });

  it("is a no-op error when the team is already on the target challenge", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: defaultResponder({
          registration: { data: { id: "reg-1", challenge_id: CHALLENGE_A, roster: [] } },
        }),
      })
    );

    const result = await adminSetTeamChallenge(TEAM, CHALLENGE_A, CHAPTER);
    expect(result.error).toMatch(/already registered/i);
    expect(
      calls.find(
        (c) =>
          c.table === "challenge_registrations" &&
          (c.op === "insert" || c.op === "update")
      )
    ).toBeUndefined();
  });
});
