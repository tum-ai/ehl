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

import { logEvent, logEventStrict, actorIntegrityError } from "@/lib/event-log";

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

// Audit-integrity guarantee: every admin/participant/jury event MUST name the
// acting account. Only "system" events (cron, deadline automation, public client
// error reports) may have no actor. A "who did this?" row with no "who" is the
// exact failure the product owner said "absolutely cannot happen".
describe("actorIntegrityError (the invariant)", () => {
  it("admin event with no actorId is a violation", () => {
    expect(
      actorIntegrityError({ ...OPTS, actorType: "admin", actorId: null })
    ).toMatch(/Audit integrity violation/);
  });

  it("admin event with empty/whitespace actorId is a violation", () => {
    expect(
      actorIntegrityError({ ...OPTS, actorType: "admin", actorId: "   " })
    ).toMatch(/Audit integrity violation/);
    expect(
      actorIntegrityError({ ...OPTS, actorType: "admin", actorId: "" })
    ).toMatch(/Audit integrity violation/);
  });

  it("participant and jury events also require an actorId", () => {
    expect(
      actorIntegrityError({ ...OPTS, actorType: "participant", actorId: null })
    ).toMatch(/Audit integrity violation/);
    expect(
      actorIntegrityError({ ...OPTS, actorType: "jury", actorId: undefined })
    ).toMatch(/Audit integrity violation/);
  });

  it("admin event WITH an actorId is fine", () => {
    expect(
      actorIntegrityError({ ...OPTS, actorType: "admin", actorId: "admin-123" })
    ).toBeNull();
  });

  it("system events are allowed without an actorId", () => {
    expect(
      actorIntegrityError({ ...OPTS, actorType: "system", actorId: null })
    ).toBeNull();
  });

  it("omitting actorType (defaults to system) is allowed without an actorId", () => {
    // The existing pre-actor call style (no actorType, no actorId) stays valid.
    expect(actorIntegrityError(OPTS)).toBeNull();
  });
});

describe("logEventStrict enforces the actor invariant (throws)", () => {
  beforeEach(() => {
    afterMock.mockReset();
    afterMock.mockImplementation(() => {});
    insertChain.insertResult = { error: null };
    insertChain.insertMock = vi.fn();
  });

  it("rejects an admin event with a null actor (and writes nothing)", async () => {
    await expect(
      logEventStrict({ ...OPTS, actorType: "admin", actorId: null })
    ).rejects.toThrow(/Audit integrity violation/);
    expect(insertChain.insertMock).not.toHaveBeenCalled();
  });

  it("persists an admin event WITH the correct actor id", async () => {
    await logEventStrict({
      action: "score.overridden",
      entityType: "score",
      entityId: "ch1",
      actorId: "admin-789",
      actorType: "admin",
      delta: {},
    });
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
    const row = insertChain.insertMock!.mock.calls[0][0] as Record<string, unknown>;
    expect(row.actor_id).toBe("admin-789");
    expect(row.actor_type).toBe("admin");
  });

  it("allows a system event with no actor", async () => {
    await expect(
      logEventStrict({ ...OPTS, actorType: "system" })
    ).resolves.toBeUndefined();
    const row = insertChain.insertMock!.mock.calls[0][0] as Record<string, unknown>;
    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBeNull();
  });
});

describe("logEvent backstops the invariant without dropping the row", () => {
  beforeEach(() => {
    afterMock.mockReset();
    afterMock.mockImplementation(() => {});
    insertChain.insertResult = { error: null };
    insertChain.insertMock = vi.fn();
  });

  it("a null-actor admin event logs loudly BUT is still written (never dropped)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent({ ...OPTS, actorType: "admin", actorId: null });
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;
    await registered();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Audit integrity violation")
    );
    // The recent fix stopped dropping audit events; the backstop must not regress
    // that. The row is still inserted (with whatever actor it could resolve).
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("a valid admin event persists the actor id and emits no integrity error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent({
      action: "setting.updated",
      entityType: "app_setting",
      entityId: "GITHUB_TOKEN",
      actorId: "admin-555",
      actorType: "admin",
      delta: {},
    });
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;
    await registered();

    const row = insertChain.insertMock!.mock.calls[0][0] as Record<string, unknown>;
    expect(row.actor_id).toBe("admin-555");
    expect(
      consoleError.mock.calls.some((c) =>
        String(c[0]).includes("Audit integrity violation")
      )
    ).toBe(false);
    consoleError.mockRestore();
  });
});
