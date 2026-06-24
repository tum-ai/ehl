import { describe, it, expect, vi, beforeEach } from "vitest";

// The Paris dry-run "Publish Results doesn't work" bug was a UI-only block: the
// button was disabled when scores.length === 0, so a chapter with no finalized
// scores could never be completed. The publishScores ACTION itself has no such
// gate. These tests pin that: the action is global-admin-only, and it succeeds
// (marks the chapter completed) even with zero score rows.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  // Audit actor resolution; reads the same (mocked) server client the action uses.
  getActingUserId: async () => {
    const c = await mocks.createClient();
    const {
      data: { user },
    } = await c.auth.getUser();
    return user?.id ?? null;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEventStrict: mocks.logEventStrict,
  logEvent: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { publishScores } from "@/lib/actions/admin";

const CHAPTER = "chapter-1";

// Mock admin client: records each table.update() and returns the configured error
// (default none). Mirrors the real `.from(t).update(p).eq(k,v)` chain.
function makeAdminClient(opts: {
  updateError?: { table: string; message: string };
  calls: Array<{ table: string; payload: unknown }>;
}) {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        update: (payload: unknown) => {
          opts.calls.push({ table, payload });
          return builder;
        },
        eq: () =>
          Promise.resolve({
            error:
              opts.updateError && opts.updateError.table === table
                ? { message: opts.updateError.message }
                : null,
          }),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
  });
});

describe("publishScores", () => {
  it("rejects a non-global-admin caller", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("succeeds and completes the chapter even with ZERO scores (Paris bug)", async () => {
    const calls: Array<{ table: string; payload: unknown }> = [];
    // No updateError -> the scores update matches 0 rows but does not error,
    // exactly as Postgres behaves for an empty match set.
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls }));

    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ success: true });

    // It published scores (no-op on 0 rows) AND set the chapter to completed.
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "scores", payload: expect.objectContaining({ published: true }) })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "chapters", payload: { status: "completed" } })
    );

    // Audit integrity: the score.published event must record the acting admin.
    expect(mocks.logEventStrict).toHaveBeenCalledTimes(1);
    const ev = mocks.logEventStrict.mock.calls[0][0];
    expect(ev.action).toBe("score.published");
    expect(ev.actorType).toBe("admin");
    expect(ev.actorId).toBe("admin-1");
  });

  it("aborts WITHOUT publishing if the acting admin cannot be resolved", async () => {
    // Guard passes but no session user -> the action must not mutate scores or
    // the chapter (which would otherwise leave a published-but-unattributed row).
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    const calls: Array<{ table: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls }));

    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ error: "Could not identify admin user." });
    expect(calls).toEqual([]); // nothing written
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });

  it("surfaces an error if the chapter status update fails", async () => {
    const calls: Array<{ table: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ updateError: { table: "chapters", message: "boom" }, calls })
    );
    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ error: "boom" });
  });
});
