import { describe, it, expect, vi, beforeEach } from "vitest";

// The admin RSVP send is scoped to one chapter. A local (chapter) admin must not
// be able to mail a chapter they do not administer. Mirrors
// tests/bulk-actions-idor.test.ts: the guard has to run BEFORE any database
// work, so a rejected caller cannot even learn whether the chapter exists.
// (Reading the answers goes through the applications API route, which is
// guarded by requireChapterAdminApi before any query.)

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderRsvpRequestEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rsvpLimiter: { prefix: "rl:rsvp" },
  rsvpTokenLimiter: { prefix: "rl:rsvp-token" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({ renderRsvpRequestEmail: mocks.renderRsvpRequestEmail }));

import { sendRsvpEmails } from "@/lib/actions/rsvp";

const DENIED = "Forbidden: you do not administer this chapter.";

function makeDb() {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    insert: () => builder,
    delete: () => builder,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActingUserId.mockResolvedValue("admin-1");
});

describe("RSVP admin authorization", () => {
  it("refuses to send for a chapter the caller does not administer", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue(DENIED);
    const db = makeDb();
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("someone-elses-chapter");

    expect(result).toEqual({ error: DENIED });
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("guards on the chapter the caller actually named", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue(DENIED);
    mocks.createAdminClient.mockReturnValue(makeDb());

    await sendRsvpEmails("chapter-x");

    expect(mocks.requireChapterAdminAction).toHaveBeenCalledWith("chapter-x");
  });

  it("proceeds for an authorized chapter admin", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(makeDb());

    const result = await sendRsvpEmails("chapter-1");

    expect(result).toEqual({ success: true, sent: 0, remaining: 0, failed: [] });
  });
});
