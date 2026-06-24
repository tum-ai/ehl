import { describe, it, expect, vi, beforeEach } from "vitest";

// adminRemoveMember lets a global admin remove a member from a team. The
// invariants under test: global-admin only, the president can never be removed,
// the target must actually be on the team, and a removal must leave the team
// with at least MIN_TEAM_SIZE (default 2) members. Only when all checks pass is
// the delete issued.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

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
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { adminRemoveMember, adminMoveMember } from "@/lib/actions/admin";

const TEAM = "team-1";
const PRESIDENT = "user-president";
const ADMIN = "caller-admin";

// Minimal chainable Supabase mock mirroring the harness in
// chapter-admins-actions.test.ts: `responder(state)` returns the result for a
// given table/op, and every terminal call is recorded in `calls`.
function makeAdminClient(opts: {
  responder: (s: {
    table: string;
    op: string;
    filters: [string, unknown][];
  }) => unknown;
  calls: Array<{ table: string; op: string }>;
}) {
  function makeBuilder() {
    const state = {
      table: "",
      op: "select",
      filters: [] as [string, unknown][],
    };
    const resolve = () => {
      opts.calls.push({ table: state.table, op: state.op });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: () => ((state.op = "select"), builder),
      insert: () => ((state.op = "insert"), builder),
      update: () => ((state.op = "update"), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
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

// Build a responder for a team whose president is PRESIDENT and whose roster is
// the given user IDs.
function teamResponder(rosterUserIds: string[]) {
  return ({ table, op }: { table: string; op: string }) => {
    if (table === "teams" && op === "select")
      return { data: { president_user_id: PRESIDENT } };
    if (table === "team_members" && op === "select")
      return { data: rosterUserIds.map((user_id) => ({ user_id })) };
    if (table === "team_members" && op === "delete") return { error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null); // global admin by default
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN } } }) },
  });
});

describe("adminRemoveMember", () => {
  it("rejects a caller who is not a global admin", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns an error when the team does not exist", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) =>
          table === "teams" && op === "select" ? { data: null } : { data: null },
      })
    );
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result.error).toMatch(/not found/i);
  });

  it("refuses to remove the team president", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    const result = await adminRemoveMember(TEAM, PRESIDENT);
    expect(result.error).toMatch(/president/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
  });

  it("refuses to remove a user who is not on the team", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    const result = await adminRemoveMember(TEAM, "stranger");
    expect(result.error).toMatch(/not a member/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
  });

  it("blocks a removal that would leave fewer than 2 members", async () => {
    // Roster of 2 -> removal would leave 1, below MIN_TEAM_SIZE.
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2"]) })
    );
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result.error).toMatch(/fewer than 2 members/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("removes a member when at least 2 would remain", async () => {
    // Roster of 3 -> removal leaves 2, at MIN_TEAM_SIZE.
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result).toEqual({ success: true });
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(true);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "team.member_removed",
        entityId: TEAM,
        delta: { deleted: { user_id: "user-2" } },
      })
    );
  });
});

const FROM = "team-from";
const TO = "team-to";

// Responder for a move: source FROM (president PRESIDENT, given roster) and
// destination TO (given roster). Reads the team_id filter to pick the roster.
function moveResponder(opts: { fromRoster: string[]; toRoster: string[] }) {
  return ({
    table,
    op,
    filters,
  }: {
    table: string;
    op: string;
    filters: [string, unknown][];
  }) => {
    const teamId = filters.find(([k]) => k === "team_id")?.[1];
    const userId = filters.find(([k]) => k === "user_id")?.[1];
    if (table === "teams" && op === "select") {
      const id = filters.find(([k]) => k === "id")?.[1];
      if (id === FROM) return { data: { president_user_id: PRESIDENT } };
      return { data: { id: TO } };
    }
    if (table === "team_members" && op === "select") {
      // maybeSingle membership/dupe checks include a user_id filter.
      if (userId !== undefined) {
        const roster = teamId === FROM ? opts.fromRoster : opts.toRoster;
        return { data: roster.includes(userId as string) ? { user_id: userId } : null };
      }
      // roster count query (team_id only)
      const roster = teamId === FROM ? opts.fromRoster : opts.toRoster;
      return { data: roster.map((user_id) => ({ user_id })) };
    }
    if (table === "team_members" && (op === "insert" || op === "delete")) {
      return { error: null };
    }
    return { data: null, error: null };
  };
}

describe("adminMoveMember", () => {
  it("blocks a move that would leave the source team below 2 members", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: moveResponder({
          fromRoster: [PRESIDENT, "user-2"], // 2 -> would leave 1
          toRoster: [],
        }),
      })
    );
    const result = await adminMoveMember("user-2", FROM, TO);
    expect(result.error).toMatch(/fewer than 2 members on the source team/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
    expect(calls.some((c) => c.table === "team_members" && c.op === "insert")).toBe(false);
  });

  it("moves a member when the source keeps at least 2", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: moveResponder({
          fromRoster: [PRESIDENT, "user-2", "user-3"], // 3 -> leaves 2
          toRoster: ["other"],
        }),
      })
    );
    const result = await adminMoveMember("user-2", FROM, TO);
    expect(result).toEqual({ success: true });
    expect(calls.some((c) => c.table === "team_members" && c.op === "insert")).toBe(true);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(true);
  });
});
