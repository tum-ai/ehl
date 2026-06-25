import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dispatchCodeReviewWorker } from "@/lib/code-review/dispatch";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPO = "owner/repo";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("dispatchCodeReviewWorker", () => {
  it("returns not_configured (and does not call fetch) when token/repo are missing", async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;

    let called = false;
    const result = await dispatchCodeReviewWorker({
      fetchImpl: (async () => {
        called = true;
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.attempted).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok && result.attempted === false) {
      expect(result.reason).toBe("not_configured");
      expect(result.message).toContain("GITHUB_TOKEN");
      expect(result.message).toContain("GITHUB_REPO");
    }
  });

  it("names only the missing variable", async () => {
    delete process.env.GITHUB_REPO;
    const result = await dispatchCodeReviewWorker({
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.attempted === false) {
      expect(result.message).toContain("GITHUB_REPO");
      expect(result.message).not.toContain("GITHUB_TOKEN");
    }
  });

  it("returns ok on a 2xx dispatch response", async () => {
    const result = await dispatchCodeReviewWorker({
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
    });
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe(204);
  });

  it("does NOT swallow an HTTP error (e.g. 404 wrong repo / bad token)", async () => {
    const result = await dispatchCodeReviewWorker({
      fetchImpl: (async () =>
        new Response("Not Found", { status: 404 })) as typeof fetch,
    });
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok && result.attempted) {
      expect(result.reason).toBe("http_error");
      expect(result.status).toBe(404);
      expect(result.message).toContain("404");
    }
  });

  it("surfaces a network error instead of swallowing it", async () => {
    const result = await dispatchCodeReviewWorker({
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok && result.attempted) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toContain("ECONNREFUSED");
    }
  });

  it("POSTs the correct event_type and repo URL", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    await dispatchCodeReviewWorker({
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string);
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe("https://api.github.com/repos/owner/repo/dispatches");
    expect(capturedBody).toEqual({ event_type: "process-code-reviews" });
  });
});
