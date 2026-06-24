import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression for the audit-integrity bug: several admin-initiated mutations wrote
// audit-log rows with actor_id = null because the call site never passed the
// acting admin's id (it set actorType: "admin" but omitted actorId). The product
// owner's requirement: an admin action's audit row MUST always record WHICH admin
// did it. These tests pin a representative sample of the previously-broken sites,
// asserting the real admin id now reaches logEvent.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));

import { upsertSetting } from "@/lib/actions/settings";
import { addAdminEmail } from "@/lib/actions/admin-users";

const ADMIN_ID = "admin-uuid-1234";

// Minimal chainable Supabase mock that resolves every terminal call to a fixed
// result. Returns { error: null } for writes and { data } for reads.
function chainable(result: { data?: unknown; error?: unknown } = { error: null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => Promise.resolve(result),
    upsert: () => Promise.resolve(result),
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  return builder;
}

describe("admin audit events record the acting admin (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue(null); // authorized admin
    mocks.getSession.mockResolvedValue({
      user: { id: ADMIN_ID },
      profile: { id: ADMIN_ID, role: "admin" },
    });
    // The authenticated server client used by the action to read the session user.
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID } } }) },
    });
  });

  it("upsertSetting logs the admin's id (was previously null)", async () => {
    // settings.upsertSetting: app_settings upsert returns no error.
    mocks.createAdminClient.mockReturnValue({
      from: () => chainable({ error: null }),
    });

    const result = await upsertSetting("GITHUB_TOKEN", "ghp_value", null);
    expect(result).toEqual({ success: true });

    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
    const arg = mocks.logEvent.mock.calls[0][0];
    expect(arg.action).toBe("setting.updated");
    expect(arg.actorType).toBe("admin");
    expect(arg.actorId).toBe(ADMIN_ID); // the bug: this used to be absent (null)
  });

  it("addAdminEmail logs the acting admin's id", async () => {
    // addAdminEmail reads the caller via createClient().auth.getUser(), then a
    // sequence of admin-client reads/writes. Make every read return what the
    // happy path needs: caller is an admin, email not already present, no
    // existing profile, insert succeeds.
    let call = 0;
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        call++;
        // 1: caller profile (role admin), 2: existing allowlist (none),
        // 3: insert allowlist (ok), 4: existing profile (none)
        if (call === 1) return chainable({ data: { role: "admin" }, error: null });
        if (call === 2) return chainable({ data: null, error: null });
        if (call === 4) return chainable({ data: null, error: null });
        return chainable({ error: null });
      },
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: "new-admin" } }, error: null }),
        },
      },
    });

    const domain = process.env.ADMIN_EMAIL_DOMAIN || "example.com";
    const result = await addAdminEmail(`new.admin@${domain}`);
    expect(result).toEqual({ success: true });

    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
    const arg = mocks.logEvent.mock.calls[0][0];
    expect(arg.action).toBe("admin.email_added");
    expect(arg.actorType).toBe("admin");
    expect(arg.actorId).toBe(ADMIN_ID); // the bug: previously omitted -> null
  });
});
