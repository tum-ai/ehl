import { describe, it, expect } from "vitest";
import { adminLoginErrorMessage } from "@/app/admin/(auth)/login/page";

// Admin login is staff-only, so it should surface the REAL reason a sign-in
// failed (which account, what error) rather than a generic message — this makes
// debugging much easier and carries no security risk.
describe("adminLoginErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(adminLoginErrorMessage(null, null, null)).toBeNull();
  });

  it("names the rejected account for not_authorized", () => {
    const msg = adminLoginErrorMessage("not_authorized", null, "someone@gmail.com");
    expect(msg).toMatch(/access denied/i);
    expect(msg).toContain("someone@gmail.com");
  });

  it("still explains not_authorized without an email", () => {
    const msg = adminLoginErrorMessage("not_authorized", null, null);
    expect(msg).toMatch(/access denied/i);
    expect(msg).toMatch(/allowlist|chapter admin/i);
  });

  it("surfaces the underlying detail for auth_failed", () => {
    const msg = adminLoginErrorMessage("auth_failed", "code expired", null);
    expect(msg).toMatch(/sign-in failed/i);
    expect(msg).toContain("code expired");
  });

  it("gives a fallback for auth_failed with no detail", () => {
    const msg = adminLoginErrorMessage("auth_failed", null, null);
    expect(msg).toMatch(/sign-in failed/i);
    expect(msg).toMatch(/try again/i);
  });

  it("shows even an unknown error code rather than swallowing it", () => {
    expect(adminLoginErrorMessage("weird_code", null, null)).toContain("weird_code");
    expect(adminLoginErrorMessage("weird_code", "boom", null)).toContain("boom");
  });
});
