import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression guard for issue #2: logEvent() was a floating promise. On Vercel
// the function instance freezes the moment a server action returns, so the audit
// insert was silently dropped (same failure mode as the dropped emails). The fix
// routes logEvent through next/server's after() in a request scope, and falls
// back to a direct run outside one (scripts/cron, where after() throws). These
// tests pin that contract:
//   1. in a request scope -> registered via after(), not run inline
//   2. the registered callback performs the insert
//   3. outside a request scope (after() throws) -> falls back to a direct insert
//   4. failures are contained (logged, never thrown into the response)
const afterMock = vi.fn();
const insertChain = vi.hoisted(() => ({
  // Resolves the per-call insert result; default success.
  insertResult: { error: null as { message: string } | null },
  insertMock: null as null | ReturnType<typeof vi.fn>,
}));

vi.mock("next/server", () => ({
  after: (cb: () => unknown) => afterMock(cb),
}));

// Minimal admin-client mock: supports the prev-hash select().order().limit().single()
// and the insert(), plus records insert calls and returns insertChain.insertResult.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            single: async () => ({ data: { entry_hash: "prev" }, error: null }),
          }),
        }),
      }),
      insert: async (...args: unknown[]) => {
        insertChain.insertMock?.(...args);
        return insertChain.insertResult;
      },
    }),
  }),
}));

import { logEvent } from "@/lib/event-log";

const OPTS = {
  action: "chapter.deleted",
  entityType: "chapter",
  entityId: "c1",
  delta: {},
};

describe("logEvent (non-blocking, request-safe)", () => {
  beforeEach(() => {
    afterMock.mockReset();
    afterMock.mockImplementation(() => {}); // default: in a request scope
    insertChain.insertResult = { error: null };
    insertChain.insertMock = vi.fn();
  });

  it("in a request scope: registers via after(), does not run the insert inline", () => {
    logEvent(OPTS);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(typeof afterMock.mock.calls[0][0]).toBe("function");
    // Deferred, so nothing inserted yet.
    expect(insertChain.insertMock).not.toHaveBeenCalled();
  });

  it("the registered after() callback performs the insert", async () => {
    logEvent(OPTS);
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(registered()).resolves.toBeUndefined();
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
  });

  it("outside a request scope (after() throws): falls back to a direct insert", async () => {
    // Simulate scripts/cron: after() throws "outside a request scope".
    afterMock.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    // Resolve when the fallback path reaches insert() (it awaits a hash + a
    // prev-hash select first, so a fixed setTimeout would race the chain).
    const inserted = new Promise<void>((resolve) => {
      insertChain.insertMock = vi.fn(() => resolve());
    });
    // Should not throw to the caller, and should still actually insert.
    expect(() => logEvent(OPTS)).not.toThrow();
    await inserted;
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
  });

  it("contains insert failures: logs, never rethrows", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    insertChain.insertResult = { error: { message: "db down" } };

    logEvent(OPTS);
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(registered()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[EventLog]"),
      expect.stringContaining("db down"),
      "chapter.deleted"
    );
    consoleError.mockRestore();
  });
});
