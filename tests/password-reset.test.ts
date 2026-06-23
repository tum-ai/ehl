import { describe, it, expect, vi, beforeEach } from "vitest";

// requestPasswordReset must never silently lie. The Paris dry-run bug: when
// generateLink failed for an EXISTING account, the action returned {success:true}
// and the user saw "email sent" though none was generated. These tests pin the
// corrected behavior: existing account + generateLink failure -> real error;
// unknown email + failure -> stay silent (no account enumeration); happy path
// -> sends and succeeds.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  sendEmailAfterResponse: vi.fn((_label: string, task: () => Promise<unknown>) => task()),
  verifyTurnstileToken: vi.fn(),
  checkRateLimit: vi.fn(),
  renderPasswordResetEmail: vi.fn(),
  renderCreateAccountInviteEmail: vi.fn(async () => "<html>create account</html>"),
  getSiteUrl: vi.fn(() => "https://example.test"),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: mocks.sendEmailAfterResponse }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  authLimiter: {},
  resetLimiter: { _name: "resetLimiter" },
  resetEmailLimiter: { _name: "resetEmailLimiter" },
}));
vi.mock("@/lib/emails/render", () => ({
  renderPasswordResetEmail: mocks.renderPasswordResetEmail,
  renderCreateAccountInviteEmail: mocks.renderCreateAccountInviteEmail,
  renderJuryInviteEmail: vi.fn(),
  renderJuryMagicLinkEmail: vi.fn(),
}));
vi.mock("@/lib/utils", async (orig) => {
  const actual = await orig<typeof import("@/lib/utils")>();
  return { ...actual, getSiteUrl: mocks.getSiteUrl };
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-forwarded-for", "1.2.3.4"]])),
}));

import { requestPasswordReset } from "@/lib/actions/auth";

/**
 * Build a mock admin client.
 * @param profile  the profiles row returned for the email (null = no profile)
 * @param linkResult  what auth.admin.generateLink resolves to
 */
function makeAdminClient(opts: {
  profile: { role?: string; name?: string } | null;
  application?: { id: string; status: string; first_name?: string } | null;
  linkResult: { data: { properties?: { hashed_token?: string } | null }; error: unknown };
  // When false, getUserById returns no user (accepted application but no account).
  authUserExists?: boolean;
}) {
  const single = vi.fn(async () => ({ data: opts.profile, error: null }));
  // applications query also ends in .single(); return application or null.
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      single: vi.fn(async () => {
        if (table === "applications") return { data: opts.application ?? null, error: null };
        return { data: opts.profile, error: null };
      }),
    };
    return builder;
  });
  return {
    from,
    auth: {
      admin: {
        generateLink: vi.fn(async () => opts.linkResult),
        getUserById: vi.fn(async () => ({
          data: { user: opts.authUserExists === false ? null : { id: "u1" } },
        })),
      },
    },
    _single: single,
  };
}

function fd(email: string): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("cf-turnstile-response", "tok");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileToken.mockResolvedValue(true);
  // Both the per-IP resetLimiter and per-recipient resetEmailLimiter pass by default.
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.renderPasswordResetEmail.mockResolvedValue("<html></html>");
  mocks.sendEmail.mockResolvedValue(undefined);
});

describe("requestPasswordReset", () => {
  it("happy path: existing participant -> generates link, sends email, succeeds", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: { role: "participant", name: "Freddy" },
        linkResult: { data: { properties: { hashed_token: "h123" } }, error: null },
      })
    );

    const res = await requestPasswordReset(fd("freddy@example.com"));
    expect(res).toEqual({ success: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    // Reset email must skip the per-address throttle.
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ skipRateLimit: true });
  });

  it("real (non-user-specific) generateLink failure -> error, NOT fake success (Paris bug)", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: { role: "participant", name: "Freddy" },
        linkResult: { data: {}, error: { message: "Database error finding user" } },
      })
    );

    const res = await requestPasswordReset(fd("freddy@example.com"));
    expect(res).not.toEqual({ success: true });
    expect(res.error).toBeTruthy();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("no enumeration oracle: a non-user-specific failure returns the SAME error for known and unknown emails", async () => {
    // Known account, real (non-not-found) failure
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: { role: "participant", name: "Freddy" },
        linkResult: { data: {}, error: { message: "Database error", status: 500 } },
      })
    );
    const known = await requestPasswordReset(fd("freddy@example.com"));

    // Unknown email, same real failure
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: null,
        linkResult: { data: {}, error: { message: "Database error", status: 500 } },
      })
    );
    const unknown = await requestPasswordReset(fd("nobody@example.com"));

    // Identical response shape -> not an oracle for account existence.
    expect(known).toEqual(unknown);
    expect(known.error).toBeTruthy();
  });

  it("genuine user_not_found (stable code) -> stays silent (enumeration protection)", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: null,
        linkResult: {
          data: { properties: null },
          error: { code: "user_not_found", status: 404, message: "User with this email not found" },
        },
      })
    );
    const res = await requestPasswordReset(fd("nobody@example.com"));
    expect(res).toEqual({ success: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("missing token with NO error is treated as a real failure, not silent success", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: { role: "participant", name: "Freddy" },
        linkResult: { data: { properties: undefined }, error: null },
      })
    );
    const res = await requestPasswordReset(fd("freddy@example.com"));
    expect(res).not.toEqual({ success: true });
    expect(res.error).toBeTruthy();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reset-email throttle (anti-bombing): identical SILENT response for known and unknown, no email sent", async () => {
    // The recipient throttle runs BEFORE any account lookup and returns the same
    // generic success regardless of account existence -> not an enumeration oracle.
    mocks.checkRateLimit.mockImplementation(async (limiter: { _name?: string }) =>
      limiter?._name === "resetEmailLimiter"
        ? { limited: true, error: "too many" }
        : { limited: false }
    );

    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: { role: "participant", name: "Freddy" },
        linkResult: { data: { properties: { hashed_token: "h" } }, error: null },
      })
    );
    const known = await requestPasswordReset(fd("freddy@example.com"));

    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        profile: null,
        linkResult: { data: { properties: null }, error: { code: "user_not_found" } },
      })
    );
    const unknown = await requestPasswordReset(fd("nobody@example.com"));

    expect(known).toEqual({ success: true });
    expect(unknown).toEqual({ success: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("admin and jury accounts are silently no-op'd (no reset email)", async () => {
    for (const role of ["admin", "jury"]) {
      mocks.createAdminClient.mockReturnValue(
        makeAdminClient({
          profile: { role },
          linkResult: { data: { properties: { hashed_token: "h" } }, error: null },
        })
      );
      const res = await requestPasswordReset(fd(`${role}@example.com`));
      expect(res).toEqual({ success: true });
    }
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("accepted application but no account -> generic success (no oracle) + create-account email", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        // No admin/jury profile role; an accepted application exists; no auth user.
        profile: { role: "participant" },
        application: { id: "app1", status: "accepted", first_name: "Frieda" },
        authUserExists: false,
        // generateLink is not reached: we return before it for this branch.
        linkResult: { data: { properties: null }, error: { code: "user_not_found" } },
      })
    );

    const res = await requestPasswordReset(fd("accepted-no-account@example.com"));
    // Same generic response as every other path -> not an enumeration oracle.
    expect(res).toEqual({ success: true });
    // A create-account invite email was sent (via the deferred helper, which the
    // mock runs inline), pointing the user to register.
    expect(mocks.renderCreateAccountInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "accepted-no-account@example.com",
        registerUrl: expect.stringContaining("/register?email="),
      })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Create your EHL account" })
    );
  });
});
