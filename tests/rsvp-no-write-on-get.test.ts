import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESSION GUARD: opening an RSVP link must never record an answer.
//
// Mail scanners (Outlook Safe Links, Gmail's proxy and friends) fetch every URL
// in a message before the recipient ever sees it. If the /rsvp/[token] page
// recorded anything on GET, every scanned mailbox would produce a fabricated
// response and the whole feature would report attendance nobody confirmed. The
// repo has already been bitten by this class of bug on password reset (see
// lib/auth-errors.ts, which names it in user-facing copy).
//
// So getRsvpByToken, the only thing the page calls, must be strictly read-only.
// This test drives it through a recording client and asserts ZERO writes, in the
// absence-of-writes style of tests/walk-in.test.ts.

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

import { getRsvpByToken } from "@/lib/actions/rsvp";

const ROW = {
  application_id: "app-1",
  response: null,
  responded_at: null,
  applications: {
    first_name: "Ada",
    chapters: {
      name: "Munich Match",
      city: "Munich",
      country: "Germany",
      date: "2026-11-14",
      date_end: null,
    },
  },
};

/** Records every mutating verb the resolver might reach for. */
function makeRecordingDb(data: unknown) {
  const mutations: string[] = [];
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (...args: unknown[]) => {
      mutations.push("insert");
      void args;
      return builder;
    },
    update: (...args: unknown[]) => {
      mutations.push("update");
      void args;
      return builder;
    },
    upsert: (...args: unknown[]) => {
      mutations.push("upsert");
      void args;
      return builder;
    },
    delete: () => {
      mutations.push("delete");
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data, error: null }),
    single: () => Promise.resolve({ data, error: null }),
  };
  return { db: { from: vi.fn(() => builder) }, mutations };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
});

describe("opening an RSVP link (the GET path)", () => {
  it("performs NO insert, update, upsert or delete", async () => {
    const { db, mutations } = makeRecordingDb(ROW);
    mocks.createAdminClient.mockReturnValue(db);

    await getRsvpByToken("scanner-prefetched-token");

    expect(mutations).toEqual([]);
  });

  it("leaves the answer untouched no matter how many times the link is fetched", async () => {
    const { db, mutations } = makeRecordingDb(ROW);
    mocks.createAdminClient.mockReturnValue(db);

    // A scanner prefetch, the recipient's own open, and a browser preview.
    for (let i = 0; i < 3; i++) {
      const result = await getRsvpByToken("scanner-prefetched-token");
      expect(result?.response).toBeNull();
    }

    expect(mutations).toEqual([]);
  });

  it("records no audit event, since nothing happened", async () => {
    const { db } = makeRecordingDb(ROW);
    mocks.createAdminClient.mockReturnValue(db);

    await getRsvpByToken("scanner-prefetched-token");

    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("sends no email as a side effect of a page view", async () => {
    const { db } = makeRecordingDb(ROW);
    mocks.createAdminClient.mockReturnValue(db);

    await getRsvpByToken("scanner-prefetched-token");

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
