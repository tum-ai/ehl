import { describe, it, expect, vi, afterEach } from "vitest";

// The dev-login path grants admin/jury/participant sessions with NO credentials,
// so these tests pin its guards precisely: the env gate, the production tripwire,
// and the persona allowlist. The two rejection paths (disabled / unknown email)
// both bail BEFORE any Supabase call, so we assert the admin client is never
// reached — proving no session can be minted on a rejected request.
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    // Mirror Next's real notFound(), which throws to halt rendering.
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import { devLoginAction } from "@/lib/actions/dev-login";
import { isDevLoginEnabled, DEV_PERSONAS } from "@/lib/dev-login";
import DevLoginPage from "@/app/dev-login/page";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

function formDataFor(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

describe("isDevLoginEnabled", () => {
  it("is true only when the flag is exactly 'true'", () => {
    delete process.env.VERCEL_ENV;

    process.env.DEV_LOGIN_ENABLED = "true";
    expect(isDevLoginEnabled()).toBe(true);

    process.env.DEV_LOGIN_ENABLED = "false";
    expect(isDevLoginEnabled()).toBe(false);

    process.env.DEV_LOGIN_ENABLED = "TRUE"; // case-sensitive on purpose
    expect(isDevLoginEnabled()).toBe(false);

    delete process.env.DEV_LOGIN_ENABLED;
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("throws if the flag is set on the Vercel production deployment", () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    expect(() => isDevLoginEnabled()).toThrow(
      "DEV_LOGIN_ENABLED must never be set on the production deployment."
    );
  });

  it("does not throw on non-production Vercel environments (preview/sim)", () => {
    process.env.DEV_LOGIN_ENABLED = "true";

    process.env.VERCEL_ENV = "preview";
    expect(isDevLoginEnabled()).toBe(true);

    // The Docker sim runs with NODE_ENV=production but no VERCEL_ENV.
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(isDevLoginEnabled()).toBe(true);
  });
});

describe("devLoginAction", () => {
  it("throws when DEV_LOGIN_ENABLED is unset", async () => {
    delete process.env.DEV_LOGIN_ENABLED;
    delete process.env.VERCEL_ENV;

    await expect(devLoginAction(formDataFor("admin@example.com"))).rejects.toThrow(
      "Dev login is disabled."
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("throws when DEV_LOGIN_ENABLED is 'false'", async () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    delete process.env.VERCEL_ENV;

    await expect(devLoginAction(formDataFor("admin@example.com"))).rejects.toThrow(
      "Dev login is disabled."
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an email that is not in the persona allowlist", async () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    delete process.env.VERCEL_ENV;

    await expect(devLoginAction(formDataFor("intruder@evil.com"))).rejects.toThrow(
      "Unknown dev persona."
    );
    // No session is minted for an off-allowlist email.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refuses to mint a session on the production deployment even for a valid persona", async () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    process.env.VERCEL_ENV = "production";

    await expect(devLoginAction(formDataFor("admin@example.com"))).rejects.toThrow(
      "DEV_LOGIN_ENABLED must never be set on the production deployment."
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("every persona email is on the allowlist (sanity)", () => {
    expect(DEV_PERSONAS.length).toBeGreaterThan(0);
    expect(DEV_PERSONAS.every((p) => p.email.endsWith("@example.com"))).toBe(true);
  });
});

describe("/dev-login page gate", () => {
  it("calls notFound() when the flag is unset", () => {
    delete process.env.DEV_LOGIN_ENABLED;
    delete process.env.VERCEL_ENV;

    expect(() => DevLoginPage()).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
