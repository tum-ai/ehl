import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  dispatchCodeReviewWorker,
  codeReviewEventType,
  DISPATCH_EVENT_TYPE,
  DISPATCH_EVENT_TYPE_TEST,
} from "@/lib/code-review/dispatch";

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

describe("codeReviewEventType (test-vs-prod routing)", () => {
  it("dispatches the PROD event type by default (no dev-login flag)", () => {
    delete process.env.DEV_LOGIN_ENABLED;
    delete process.env.VERCEL_ENV;
    expect(codeReviewEventType()).toBe(DISPATCH_EVENT_TYPE);
    expect(codeReviewEventType()).toBe("process-code-reviews");
  });

  it("dispatches the TEST event type on a sim/preview deployment (DEV_LOGIN_ENABLED=true)", () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    // preview/sim: VERCEL_ENV is "preview" or undefined (Docker sim), never "production".
    delete process.env.VERCEL_ENV;
    expect(codeReviewEventType()).toBe(DISPATCH_EVENT_TYPE_TEST);
    expect(codeReviewEventType()).toBe("process-code-reviews-test");
  });

  it("treats DEV_LOGIN_ENABLED other than 'true' as prod (no accidental test routing)", () => {
    process.env.DEV_LOGIN_ENABLED = "1"; // not the literal "true"
    delete process.env.VERCEL_ENV;
    expect(codeReviewEventType()).toBe(DISPATCH_EVENT_TYPE);
  });

  it("THROWS via the dev-login tripwire if the flag is set on production (can never send the test event)", () => {
    // The hard tripwire in isDevLoginEnabled() makes it impossible for a real
    // production deployment to select the test event type: if the flag were ever
    // set on prod, evaluating the route throws loudly instead of routing to test.
    process.env.DEV_LOGIN_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    expect(() => codeReviewEventType()).toThrow(/never be set on a production deployment/i);
  });

  it("the actual dispatch sends the TEST event type when on a sim/preview deployment", async () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    delete process.env.VERCEL_ENV;
    let capturedBody: unknown = null;
    await dispatchCodeReviewWorker({
      fetchImpl: (async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    expect(capturedBody).toEqual({ event_type: "process-code-reviews-test" });
  });
});
