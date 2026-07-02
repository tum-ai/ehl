import { describe, it, expect, vi, beforeEach } from "vitest";

// getShowcaseByToken is the single gate every showcase consumer (public page,
// CV proxy) resolves through. This test pins its security contract:
//   - null UNIFORMLY for missing / disabled / expired showcases (no oracle);
//   - a real DB error THROWS (outage must hit the error boundary, not render
//     every shared partner link as a permanent 404);
//   - per-IP rate limiting runs BEFORE any DB work, so the resolver cannot be
//     used as an unthrottled token-validity oracle.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getSession: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  showcaseLimiter: { prefix: "rl:showcase" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/admin-auth", () => ({ requireChapterAdminAction: mocks.requireChapterAdminAction }));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));

import { getShowcaseByToken } from "@/lib/actions/showcase";

function makeDb(result: { data?: unknown; error?: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: vi.fn(() => builder) };
}

const LIVE_ROW = {
  chapter_id: "chapter-a",
  is_enabled: true,
  show_cvs: true,
  expires_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.createAdminClient.mockReturnValue(makeDb({ data: LIVE_ROW }));
});

describe("getShowcaseByToken", () => {
  it("resolves a live (enabled, unexpired) showcase", async () => {
    const result = await getShowcaseByToken("some-token");
    expect(result).toEqual({ chapterId: "chapter-a", showCvs: true });
  });

  it("returns null for an unknown token", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ data: null }));
    expect(await getShowcaseByToken("nope")).toBeNull();
  });

  it("returns null when the showcase is disabled", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ data: { ...LIVE_ROW, is_enabled: false } })
    );
    expect(await getShowcaseByToken("some-token")).toBeNull();
  });

  it("returns null when the showcase is expired", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ data: { ...LIVE_ROW, expires_at: "2020-01-01T00:00:00Z" } })
    );
    expect(await getShowcaseByToken("some-token")).toBeNull();
  });

  it("still resolves when the expiry is in the future", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ data: { ...LIVE_ROW, expires_at: "2999-01-01T00:00:00Z" } })
    );
    expect(await getShowcaseByToken("some-token")).not.toBeNull();
  });

  it("THROWS on a DB error instead of returning null (outage must not read as 'link revoked')", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ error: new Error("connection refused") })
    );
    await expect(getShowcaseByToken("some-token")).rejects.toThrow("connection refused");
  });

  it("returns null without any DB work when rate-limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Too many requests" });
    const db = makeDb({ data: LIVE_ROW });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await getShowcaseByToken("some-token")).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns null for an empty token without rate-limit or DB work", async () => {
    expect(await getShowcaseByToken("")).toBeNull();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });
});
