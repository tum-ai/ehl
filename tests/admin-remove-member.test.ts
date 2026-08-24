import { describe, it, expect, vi, beforeEach } from "vitest";

// adminRemoveMember lets a global admin remove a member from a team.
//
// Munich-2 changed what this action is for. It used to refuse a removal that
// would drop the team below MIN_TEAM_SIZE and never offered the captain at all,
// so the only thing an operator could do with a no-show was MOVE them, and on
// the day that meant editing rows by hand. An admin can now remove anybody,
// captain included; MIN_TEAM_SIZE stays a hard rule only where participants act
// on their own behalf (challenge registration).
//
// The invariants that remain: global-admin only, the target must actually be on
// the team, a team never ends up with a president who is no longer on it, and
// the caller is TOLD what the removal did (remaining count, below-minimum,
// emptied, who was promoted) rather than being silently refused.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getActingUserId,
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
      order: () => builder,
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

// Responder for a team whose president is PRESIDENT and whose roster is the
// given user IDs, ordered oldest-joined first (which is the order the action
// asks for, and the order that decides who gets promoted).
function teamResponder(rosterUserIds: string[]) {
  return ({ table, op }: { table: string; op: string }) => {
    if (table === "teams" && op === "select")
      return { data: { president_user_id: PRESIDENT } };
    if (table === "team_members" && op === "select") {
      return {
        data: rosterUserIds.map((user_id, i) => ({
          user_id,
          role: user_id === PRESIDENT ? "president" : "member",
          joined_at: `2026-08-0${i + 1}T00:00:00Z`,
        })),
      };
    }
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null); // global admin by default
  mocks.getActingUserId.mockResolvedValue(ADMIN);
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

  it("refuses to remove a user who is not on the team", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    const result = await adminRemoveMember(TEAM, "stranger");
    expect(result.error).toMatch(/not a member/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
  });

  it("removes an ordinary member and reports what remains", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      belowMinimum: false,
      teamEmptied: false,
      promotedUserId: null,
      wasCaptain: false,
    });
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(true);
  });

  // The Munich-2 change: this used to be refused outright.
  it("ALLOWS a removal that drops the team below the minimum, and flags it", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2"]) })
    );
    const result = await adminRemoveMember(TEAM, "user-2");
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, remaining: 1, belowMinimum: true });
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(true);
  });

  it("records the below-minimum removal in the audit log", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls: [], responder: teamResponder([PRESIDENT, "user-2"]) })
    );
    await adminRemoveMember(TEAM, "user-2");
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "team.member_removed",
        entityId: TEAM,
        delta: expect.objectContaining({
          deleted: { user_id: "user-2", was_captain: false },
          remaining: 1,
          below_minimum: true,
        }),
      })
    );
  });

  // The other half of the Munich-2 change: the captain had no Remove control at
  // all, so a captain who never showed up could only be worked around.
  it("removes the CAPTAIN and promotes the longest-tenured survivor", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: teamResponder([PRESIDENT, "user-2", "user-3"]),
      })
    );
    const result = await adminRemoveMember(TEAM, PRESIDENT);
    expect(result).toMatchObject({
      success: true,
      wasCaptain: true,
      promotedUserId: "user-2", // oldest joined_at among the survivors
      remaining: 2,
    });
    expect(calls.some((c) => c.table === "teams" && c.op === "update")).toBe(true);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(true);
  });

  // Promotion must land before the delete: if the delete then fails, the team
  // still has a valid president. The reverse order can leave a team with none.
  it("promotes BEFORE deleting the captain", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT, "user-2", "user-3"]) })
    );
    await adminRemoveMember(TEAM, PRESIDENT);
    const promoteIdx = calls.findIndex((c) => c.table === "teams" && c.op === "update");
    const deleteIdx = calls.findIndex(
      (c) => c.table === "team_members" && c.op === "delete"
    );
    expect(promoteIdx).toBeGreaterThanOrEqual(0);
    expect(promoteIdx).toBeLessThan(deleteIdx);
  });

  it("does not delete the member if the promotion fails", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "teams" && op === "select")
            return { data: { president_user_id: PRESIDENT } };
          if (table === "teams" && op === "update")
            return { error: { message: "db down" } };
          if (table === "team_members" && op === "select")
            return {
              data: [PRESIDENT, "user-2"].map((user_id, i) => ({
                user_id,
                role: user_id === PRESIDENT ? "president" : "member",
                joined_at: `2026-08-0${i + 1}T00:00:00Z`,
              })),
            };
          return { data: null, error: null };
        },
      })
    );
    const result = await adminRemoveMember(TEAM, PRESIDENT);
    expect(result.error).toMatch(/promote a new captain/i);
    expect(calls.some((c) => c.table === "team_members" && c.op === "delete")).toBe(false);
  });

  it("empties the team when the last member is removed, and clears the president", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT]) })
    );
    const result = await adminRemoveMember(TEAM, PRESIDENT);
    expect(result).toMatchObject({
      success: true,
      remaining: 0,
      teamEmptied: true,
      belowMinimum: true,
      promotedUserId: null,
    });
    // No promotion is possible, so the president pointer is nulled instead of
    // being left pointing at somebody who is no longer on the team.
    expect(calls.some((c) => c.table === "teams" && c.op === "update")).toBe(true);
  });

  it("does not delete the team itself when it is emptied", async () => {
    const calls: Array<{ table: string; op: string }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: teamResponder([PRESIDENT]) })
    );
    await adminRemoveMember(TEAM, PRESIDENT);
    expect(calls.some((c) => c.table === "teams" && c.op === "delete")).toBe(false);
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
