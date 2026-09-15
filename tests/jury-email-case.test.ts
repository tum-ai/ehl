import { describe, it, expect, vi, beforeEach } from "vitest";

// A juror invited as "Jane.Doe@Sponsor.com" had that mixed-case address stored
// on their profile, while signInJury looked the profile up by the LOWERCASED
// address with an exact match. The row was never found, and the juror was told
// "No jury account found for this email" on the very address the invite reached.
// These tests pin both halves of the fix: invites store the address lowercased,
// and login matches existing mixed-case rows case-insensitively.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  checkRateLimit: vi.fn(),
  getLockingTeamId: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  authLimiter: {},
  resetLimiter: {},
  resetEmailLimiter: {},
}));
vi.mock("@/lib/emails/render", () => ({
  renderPasswordResetEmail: vi.fn(),
  renderCreateAccountInviteEmail: vi.fn(),
  renderJuryInviteEmail: vi.fn(async () => "<html>invite</html>"),
  renderJuryMagicLinkEmail: vi.fn(async () => "<html>login</html>"),
}));
vi.mock("@/lib/utils", async (orig) => {
  const actual = await orig<typeof import("@/lib/utils")>();
  return { ...actual, getSiteUrl: () => "https://example.test" };
});
vi.mock("@/lib/team-membership", () => ({ getLockingTeamId: mocks.getLockingTeamId }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-forwarded-for", "1.2.3.4"]])),
}));

import { inviteJury, signInJury } from "@/lib/actions/auth";
import { escapeLikePattern } from "@/lib/utils";

type Profile = { id: string; email: string; role: string; name: string };

/** Postgres ILIKE with backslash escapes, so the mock matches like the real DB. */
function ilikeMatches(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(value);
}

/**
 * Admin client over an in-memory profiles table. `eq` is case-sensitive and
 * `ilike` is not, exactly as in Postgres, so a lookup that only "works" because
 * the mock is lenient cannot pass.
 */
function makeAdminClient(profiles: Profile[]) {
  const upserts: Record<string, Record<string, unknown>[]> = {};
  const from = vi.fn((table: string) => {
    let rows: Record<string, unknown>[] = table === "profiles" ? [...profiles] : [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      ilike: (col: string, pattern: string) => {
        rows = rows.filter((r) => ilikeMatches(String(r[col]), pattern));
        return builder;
      },
      single: async () => ({ data: rows.length === 1 ? rows[0] : null, error: null }),
      upsert: async (row: Record<string, unknown>) => {
        (upserts[table] ??= []).push(row);
        return { error: null };
      },
    };
    return builder;
  });
  const generateLink = vi.fn(async () => ({
    data: { properties: { hashed_token: "h123" } },
    error: null,
  }));
  return {
    client: {
      from,
      auth: {
        admin: {
          createUser: vi.fn(async () => ({ data: { user: { id: "new-user" } }, error: null })),
          getUserById: vi.fn(async (id: string) => ({ data: { user: { id } }, error: null })),
          generateLink,
        },
      },
    },
    upserts,
    generateLink,
  };
}

function loginForm(email: string): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("cf-turnstile-response", "tok");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileToken.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.getLockingTeamId.mockResolvedValue(null);
});

describe("signInJury email case", () => {
  it("finds a juror whose stored profile email is mixed case", async () => {
    const db = makeAdminClient([
      { id: "j1", email: "Jane.Doe@Sponsor.com", role: "jury", name: "Jane" },
    ]);
    mocks.createAdminClient.mockReturnValue(db.client);

    const res = await signInJury(loginForm("jane.doe@sponsor.com"));

    expect(res).toEqual({ success: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("finds a lowercase profile when the juror types capitals", async () => {
    const db = makeAdminClient([
      { id: "j1", email: "jane.doe@sponsor.com", role: "jury", name: "Jane" },
    ]);
    mocks.createAdminClient.mockReturnValue(db.client);

    const res = await signInJury(loginForm("  Jane.Doe@Sponsor.com "));

    expect(res).toEqual({ success: true });
  });

  it("does not let an underscore act as a wildcard", async () => {
    const db = makeAdminClient([
      { id: "j1", email: "axb@sponsor.com", role: "jury", name: "Other" },
    ]);
    mocks.createAdminClient.mockReturnValue(db.client);

    const res = await signInJury(loginForm("a_b@sponsor.com"));

    expect(res).toEqual({ error: "No jury account found for this email." });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("still refuses a matching profile that is not jury or admin", async () => {
    const db = makeAdminClient([
      { id: "p1", email: "Jane.Doe@Sponsor.com", role: "participant", name: "Jane" },
    ]);
    mocks.createAdminClient.mockReturnValue(db.client);

    const res = await signInJury(loginForm("jane.doe@sponsor.com"));

    expect(res).toEqual({ error: "No jury account found for this email." });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("inviteJury email case", () => {
  it("stores, links and mails the lowercased address when the admin types capitals", async () => {
    const db = makeAdminClient([]);
    mocks.createAdminClient.mockReturnValue(db.client);

    const res = await inviteJury(" Jane.Doe@Sponsor.com ", "Jane", "ch-1", "chap-1");

    expect(res).toEqual({ success: true, userId: "new-user" });
    expect(db.upserts.profiles[0]).toMatchObject({ id: "new-user", email: "jane.doe@sponsor.com" });
    expect(db.client.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane.doe@sponsor.com" })
    );
    expect(db.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane.doe@sponsor.com" })
    );
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ to: "jane.doe@sponsor.com" });
  });

  it("a juror invited with capitals can then log in", async () => {
    const db = makeAdminClient([]);
    mocks.createAdminClient.mockReturnValue(db.client);
    await inviteJury("Jane.Doe@Sponsor.com", "Jane", "ch-1", "chap-1");
    const stored = db.upserts.profiles[0] as Profile;

    const loginDb = makeAdminClient([{ ...stored, role: "jury" }]);
    mocks.createAdminClient.mockReturnValue(loginDb.client);

    expect(await signInJury(loginForm("Jane.Doe@Sponsor.com"))).toEqual({ success: true });
  });
});

describe("escapeLikePattern", () => {
  it("escapes underscore, percent and backslash", () => {
    expect(escapeLikePattern("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });

  it("leaves an ordinary email unchanged", () => {
    expect(escapeLikePattern("jane.doe@sponsor.com")).toBe("jane.doe@sponsor.com");
  });
});
