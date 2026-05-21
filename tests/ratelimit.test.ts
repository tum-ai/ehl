import { describe, it, expect, beforeEach } from "vitest";
import { checkMemoryLimit, _resetMemoryStore } from "@/lib/ratelimit";

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

  it("enforces auth limits (60 per 60s for hackathon shared WiFi)", () => {
    const authLimit = 60;
    for (let i = 0; i < authLimit; i++) {
      expect(checkMemoryLimit("auth:ip1", authLimit, 60_000)).toBe(true);
    }
    expect(checkMemoryLimit("auth:ip1", authLimit, 60_000)).toBe(false);
  });

  it("enforces register limits (60 per 60s for hackathon shared WiFi)", () => {
    const registerLimit = 60;
    for (let i = 0; i < registerLimit; i++) {
      expect(checkMemoryLimit("register:ip1", registerLimit, 60_000)).toBe(true);
    }
    expect(checkMemoryLimit("register:ip1", registerLimit, 60_000)).toBe(false);
  });

  it("allows generous API limits (200 per 60s)", () => {
    const apiLimit = 200;
    for (let i = 0; i < apiLimit; i++) {
      expect(checkMemoryLimit("api:ip1", apiLimit, 60_000)).toBe(true);
    }
    expect(checkMemoryLimit("api:ip1", apiLimit, 60_000)).toBe(false);
  });
});
