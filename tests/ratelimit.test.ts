import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkMemoryLimit, _resetMemoryStore } from "@/lib/ratelimit";

// Load a fresh copy of the rate-limit module with NO Redis env vars set, so
// Redis.fromEnv() throws and every limiter is null. That forces checkRateLimit
// down the in-memory fallback path, letting us assert the REAL per-limiter
// fallback limits (auth/register = 500/min, upload = 10/min) without making
// any network calls to a live Redis.
async function loadRatelimitWithoutRedis() {
  const REDIS_VARS = [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "KV_URL",
    "REDIS_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of REDIS_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
  const mod = await import("@/lib/ratelimit");
  for (const [k, v] of Object.entries(saved)) {
    if (v !== undefined) process.env[k] = v;
  }
  return mod;
}

// ─── In-memory fallback rate limiter ─────────────────────────

describe("checkMemoryLimit", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("allows requests under the limit", () => {
    expect(checkMemoryLimit("user:1", 3, 60_000)).toBe(true);
    expect(checkMemoryLimit("user:1", 3, 60_000)).toBe(true);
    expect(checkMemoryLimit("user:1", 3, 60_000)).toBe(true);
  });

  it("blocks requests at the limit", () => {
    expect(checkMemoryLimit("user:2", 2, 60_000)).toBe(true);
    expect(checkMemoryLimit("user:2", 2, 60_000)).toBe(true);
    expect(checkMemoryLimit("user:2", 2, 60_000)).toBe(false);
  });

  it("tracks identifiers independently", () => {
    expect(checkMemoryLimit("user:a", 1, 60_000)).toBe(true);
    expect(checkMemoryLimit("user:b", 1, 60_000)).toBe(true);
    // a is now limited, b is not affected
    expect(checkMemoryLimit("user:a", 1, 60_000)).toBe(false);
    expect(checkMemoryLimit("user:b", 1, 60_000)).toBe(false);
  });

  it("uses default limits when not specified", () => {
    // Default: 10 requests, 60s window
    for (let i = 0; i < 10; i++) {
      expect(checkMemoryLimit("default:1")).toBe(true);
    }
    expect(checkMemoryLimit("default:1")).toBe(false);
  });

  it("respects custom window duration", () => {
    // Use a very short window (1ms) so entries expire immediately
    expect(checkMemoryLimit("window:1", 1, 1)).toBe(true);
    // Wait just enough for the window to expire
    const start = Date.now();
    while (Date.now() - start < 2) {
      // busy-wait 2ms
    }
    // Should be allowed again since the window expired
    expect(checkMemoryLimit("window:1", 1, 1)).toBe(true);
  });

  it("respects an arbitrary caller-supplied limit", () => {
    const limit = 60;
    for (let i = 0; i < limit; i++) {
      expect(checkMemoryLimit("custom:ip1", limit, 60_000)).toBe(true);
    }
    expect(checkMemoryLimit("custom:ip1", limit, 60_000)).toBe(false);
  });
});

// ─── checkRateLimit (real per-limiter fallback config) ──────
// Redis is not configured in tests, so the limiters are null and checkRateLimit
// uses the in-memory fallback with each limiter's REAL configured limit. These
// tests assert the actual policy (auth/register = 500/min), not an arbitrary
// literal — so a change to those limits is caught here.

describe("checkRateLimit fallback policy (no Redis)", () => {
  it("has null Redis limiters but keeps fallback config when Redis env is absent", async () => {
    const mod = await loadRatelimitWithoutRedis();
    expect(mod.authLimiter.limiter).toBeNull();
    expect(mod.registerLimiter.limiter).toBeNull();
    expect(mod.uploadLimiter.limiter).toBeNull();
    // The fallback config survives even with no Redis (the bug this guards).
    expect(mod.authLimiter.fallback).toEqual({ limit: 500, windowMs: 60_000 });
    expect(mod.uploadLimiter.fallback).toEqual({ limit: 10, windowMs: 60_000 });
  });

  it("allows 500 auth requests then blocks the 501st", async () => {
    const mod = await loadRatelimitWithoutRedis();
    mod._resetMemoryStore();
    for (let i = 0; i < 500; i++) {
      expect((await mod.checkRateLimit(mod.authLimiter, "auth-ip", "login")).limited).toBe(false);
    }
    const blocked = await mod.checkRateLimit(mod.authLimiter, "auth-ip", "login");
    expect(blocked.limited).toBe(true);
    expect(blocked.error).toMatch(/too many/i);
  });

  it("applies the same 500 fallback to registration", async () => {
    const mod = await loadRatelimitWithoutRedis();
    mod._resetMemoryStore();
    for (let i = 0; i < 500; i++) {
      expect((await mod.checkRateLimit(mod.registerLimiter, "reg-ip")).limited).toBe(false);
    }
    expect((await mod.checkRateLimit(mod.registerLimiter, "reg-ip")).limited).toBe(true);
  });

  it("applies a tighter fallback to uploads (10/min)", async () => {
    const mod = await loadRatelimitWithoutRedis();
    mod._resetMemoryStore();
    for (let i = 0; i < 10; i++) {
      expect((await mod.checkRateLimit(mod.uploadLimiter, "up-ip")).limited).toBe(false);
    }
    expect((await mod.checkRateLimit(mod.uploadLimiter, "up-ip")).limited).toBe(true);
  });
});
