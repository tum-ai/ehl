import { describe, it, expect, vi, beforeEach } from "vitest";

// submitRsvp is the ONLY path that records an RSVP answer, and it runs on a
// deliberate click (POST), never on page load. This test pins:
//   - "yes" and "no" are both recorded, with a responded_at stamp;
//   - THE LOCK: the update is conditional on `response IS NULL`, so the first
//     answer wins even when two submits race. A second, differing submit must
//     not overwrite; it reports the answer that already stands;
//   - anything other than "yes"/"no" is rejected before any write;
//   - an unknown token writes nothing and stays a uniform failure (no oracle);
//   - a rate-limited submit writes nothing.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderRsvpRequestEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rsvpLimiter: { prefix: "rl:rsvp" },
  rsvpTokenLimiter: { prefix: "rl:rsvp-token" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({ renderRsvpRequestEmail: mocks.renderRsvpRequestEmail }));

import { submitRsvp } from "@/lib/actions/rsvp";

interface Call {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  isFilters: [string, unknown][];
}

/**
 * Recording Supabase mock. `responder` decides what each call resolves to; every
 * call (including its `.is()` filters, which carry the lock) is recorded so
 * tests can assert on writes and on their absence.
 */
function makeDb(responder: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", isFilters: [] };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: (col: string, val: unknown) => {
        call.isFilters.push([col, val]);
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        call.op = "update";
        call.payload = payload;
        calls.push(call);
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        call.op = "insert";
        call.payload = payload;
        calls.push(call);
        return builder;
      },
      delete: () => {
        call.op = "delete";
        calls.push(call);
        return builder;
      },
      maybeSingle: () => {
        if (call.op === "select") calls.push(call);
        const r = responder(call);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      },
      single: () => {
        if (call.op === "select") calls.push(call);
        const r = responder(call);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      },
    };
    return builder;
  });
  return { db: { from }, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => c.op !== "select");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
});

describe("submitRsvp", () => {
  it.each(["yes", "no"] as const)("records a %s answer", async (answer) => {
    const { db, calls } = makeDb((call) =>
      call.op === "update" ? { data: { application_id: "app-1", response: answer } } : {}
    );
    mocks.createAdminClient.mockReturnValue(db);

    const result = await submitRsvp("tok", answer);

    expect(result).toEqual({ success: true, response: answer, alreadyAnswered: false });
    const update = writes(calls).find((c) => c.op === "update");
    expect(update?.payload?.response).toBe(answer);
    expect(update?.payload?.responded_at).toEqual(expect.any(String));
  });

  it("guards the write with `response IS NULL` so the first answer wins a race", async () => {
    const { db, calls } = makeDb((call) =>
      call.op === "update" ? { data: { application_id: "app-1", response: "yes" } } : {}
    );
    mocks.createAdminClient.mockReturnValue(db);

    await submitRsvp("tok", "yes");

    const update = writes(calls).find((c) => c.op === "update");
    expect(update?.isFilters).toContainEqual(["response", null]);
  });

  it("does NOT overwrite a standing answer, and reports the one that stands", async () => {
    // The conditional update matches no row because response is already set.
    const { db, calls } = makeDb((call) => {
      if (call.op === "update") return { data: null };
      return { data: { response: "yes" } };
    });
    mocks.createAdminClient.mockReturnValue(db);

    const result = await submitRsvp("tok", "no");

    expect(result).toEqual({ success: true, response: "yes", alreadyAnswered: true });
    // The only write attempted was the guarded no-op update.
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0].isFilters).toContainEqual(["response", null]);
  });

  it("logs an audit event only when an answer was actually recorded", async () => {
    const { db } = makeDb((call) => (call.op === "update" ? { data: null } : { data: { response: "no" } }));
    mocks.createAdminClient.mockReturnValue(db);

    await submitRsvp("tok", "yes");
    expect(mocks.logEvent).not.toHaveBeenCalled();

    const fresh = makeDb((call) =>
      call.op === "update" ? { data: { application_id: "app-2", response: "yes" } } : {}
    );
    mocks.createAdminClient.mockReturnValue(fresh.db);
    await submitRsvp("tok", "yes");
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.rsvp_responded", entityId: "app-2" })
    );
  });

  it("rejects a response value that is not yes or no, without writing", async () => {
    const { db, calls } = makeDb(() => ({}));
    mocks.createAdminClient.mockReturnValue(db);

    const result = await submitRsvp("tok", "maybe" as unknown as "yes");

    expect(result).toEqual({ error: "Invalid response." });
    expect(writes(calls)).toHaveLength(0);
  });

  it("rejects an empty token before spending a rate-limit token or writing", async () => {
    const { db, calls } = makeDb(() => ({}));
    mocks.createAdminClient.mockReturnValue(db);

    const result = await submitRsvp("", "yes");

    expect(result).toEqual({ error: "Invalid RSVP link." });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  it("reports an unknown token as invalid rather than as an answer", async () => {
    const { db } = makeDb(() => ({ data: null }));
    mocks.createAdminClient.mockReturnValue(db);

    expect(await submitRsvp("nope", "yes")).toEqual({ error: "Invalid RSVP link." });
  });

  it("writes nothing when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Too many requests" });
    const { db, calls } = makeDb(() => ({}));
    mocks.createAdminClient.mockReturnValue(db);

    const result = await submitRsvp("tok", "yes");

    expect(result).toEqual({ error: "Too many requests" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("rate limits per token as well as per IP", async () => {
    const { db } = makeDb((call) =>
      call.op === "update" ? { data: { application_id: "app-1", response: "yes" } } : {}
    );
    mocks.createAdminClient.mockReturnValue(db);

    await submitRsvp("tok", "yes");

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      { prefix: "rl:rsvp-token" },
      "tok",
      "rsvp-token"
    );
  });
});
