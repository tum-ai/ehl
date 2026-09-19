import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESSION GUARD: opening a Grand Finale invite link must never answer it.
//
// Mail scanners (Outlook Safe Links, Gmail's proxy and friends) fetch every URL
// in a message before the recipient ever sees it. Here the stakes are higher
// than for the RSVP: answering "yes" CREATES AN ACCEPTED APPLICATION and mails a
// check-in QR code, so a scanner that triggered a write would register finalists
// who never clicked, and would do it for entire teams at once.
//
// getFinaleInviteByToken, the only thing the page calls, must therefore be
// strictly read-only. This drives it through a recording client and asserts ZERO
// writes, in the same style as tests/rsvp-no-write-on-get.test.ts.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderFinaleInviteEmail: vi.fn(),
  sendEmailAfterResponse: vi.fn(),
  sendAcceptanceEmailForApplication: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rsvpLimiter: { prefix: "rl:rsvp" },
  rsvpTokenLimiter: { prefix: "rl:rsvp-token" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: mocks.sendEmailAfterResponse }));
vi.mock("@/lib/emails/render", () => ({ renderFinaleInviteEmail: mocks.renderFinaleInviteEmail }));
vi.mock("@/lib/acceptance-email", () => ({
  sendAcceptanceEmailForApplication: mocks.sendAcceptanceEmailForApplication,
}));

import { getFinaleInviteByToken } from "@/lib/actions/finale-invites";
import { makeDb, writes } from "./finale-invite-helpers";

/** A well-formed token: this file is about write behavior, not token shape. */
const SCANNER_TOKEN = "09bc21bb-0ec0-4aa1-903a-ba5ec01d41d4";

const ROW = {
  email: "ada@example.com",
  response: null,
  application_id: null,
  teams: { name: "bussies" },
  profiles: { name: "Ada Lovelace" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue({ get: () => "127.0.0.1" });
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
});

describe("getFinaleInviteByToken", () => {
  it("performs NO writes when a scanner opens the link", async () => {
    const { db, calls } = makeDb({ select: { finale_invites: { data: ROW, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);

    await getFinaleInviteByToken(SCANNER_TOKEN);

    expect(writes(calls)).toEqual([]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendAcceptanceEmailForApplication).not.toHaveBeenCalled();
  });

  it("resolves the person, their team and their standing answer", async () => {
    const { db } = makeDb({
      select: {
        finale_invites: {
          data: { ...ROW, response: "yes", application_id: "app-1" },
          error: null,
        },
      },
    });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await getFinaleInviteByToken(SCANNER_TOKEN)).toEqual({
      firstName: "Ada",
      teamName: "bussies",
      response: "yes",
      accepted: true,
    });
  });

  it("returns null for an unknown token", async () => {
    const { db } = makeDb({ select: { finale_invites: { data: null, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await getFinaleInviteByToken(SCANNER_TOKEN)).toBeNull();
  });

  it("returns null for a malformed token without touching the database", async () => {
    // Mail clients wrap and truncate long URLs, so real recipients arrive with a
    // mangled token. Postgres rejects a non-uuid literal outright, which would
    // render a 500 instead of a clean 404.
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("database must not be touched");
    });

    expect(await getFinaleInviteByToken("not-a-uuid")).toBeNull();
  });

  it("throws on a database error rather than making every link look dead", async () => {
    const { db } = makeDb({
      select: { finale_invites: { data: null, error: new Error("supabase down") } },
    });
    mocks.createAdminClient.mockReturnValue(db);

    await expect(getFinaleInviteByToken(SCANNER_TOKEN)).rejects.toThrow("supabase down");
  });
});
