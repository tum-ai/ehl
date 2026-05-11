import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// verifyTurnstileToken is a server action ("use server"), but we can test
// the core logic by importing it in a vitest environment.

describe("verifyTurnstileToken", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Force production mode so the dev bypass doesn't trigger
    process.env.NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  async function loadModule() {
    // Re-import to pick up env changes
    const mod = await import("@/lib/turnstile");
    return mod.verifyTurnstileToken;
  }

  it("returns true in development mode regardless of token", async () => {
    process.env.NODE_ENV = "development";
    const verify = await loadModule();
    expect(await verify(null)).toBe(true);
    expect(await verify("")).toBe(true);
    expect(await verify("any-token")).toBe(true);
  });

  it("returns false when TURNSTILE_SECRET_KEY is not set", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const verify = await loadModule();
    expect(await verify("some-token")).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith("TURNSTILE_SECRET_KEY not set");
    consoleSpy.mockRestore();
  });

  it("returns false when token is null", async () => {
    const verify = await loadModule();
    expect(await verify(null)).toBe(false);
  });

  it("returns false when token is empty string", async () => {
    const verify = await loadModule();
    // Empty string is falsy, so it should fail the !token check
    expect(await verify("")).toBe(false);
  });

  it("returns true when Cloudflare responds with success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });
    const verify = await loadModule();
    expect(await verify("valid-token")).toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
  });

  it("returns false when Cloudflare responds with failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    const verify = await loadModule();
    expect(await verify("invalid-token")).toBe(false);
  });

  it("returns false when fetch throws a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const verify = await loadModule();
    expect(await verify("some-token")).toBe(false);
    consoleSpy.mockRestore();
  });

  it("sends the correct secret and token to Cloudflare", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });
    const verify = await loadModule();
    await verify("my-test-token");

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = callArgs[1].body as URLSearchParams;
    expect(body.get("secret")).toBe("test-secret-key");
    expect(body.get("response")).toBe("my-test-token");
  });
});
