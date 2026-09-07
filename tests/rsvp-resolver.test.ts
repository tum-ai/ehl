import { describe, it, expect, vi, beforeEach } from "vitest";

// getRsvpByToken is the only gate on the public /rsvp/[token] page. This test
// pins its security contract, mirroring tests/showcase-resolver.test.ts:
//   - null UNIFORMLY for an unknown token (no existence oracle);
//   - a real DB error THROWS, so a Supabase outage hits the error boundary
//     instead of rendering every emailed RSVP link as a permanent 404;
//   - per-IP rate limiting runs BEFORE any DB work, so the resolver cannot be
//     used as an unthrottled token-validity oracle;
//   - an empty token spends neither a rate-limit token nor a query;
//   - an already-answered token still resolves, carrying the standing answer,
//     so the page can show it instead of re-asking.

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

/** Well-formed tokens; the resolver shape-checks before it queries. */
const TOKEN = "09bc21bb-0ec0-4aa1-903a-ba5ec01d41d4";
const UNKNOWN_TOKEN = "00000000-0000-0000-0000-0000000000ff";

function makeDb(result: { data?: unknown; error?: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: vi.fn(() => builder) };
}

const LIVE_ROW = {
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
      date_end: "2026-11-15",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.createAdminClient.mockReturnValue(makeDb({ data: LIVE_ROW }));
});

describe("getRsvpByToken", () => {
  it("resolves an unanswered RSVP with the applicant and chapter details", async () => {
    const result = await getRsvpByToken(TOKEN);
    expect(result).toEqual({
      applicationId: "app-1",
      firstName: "Ada",
      chapterName: "Munich Match",
      chapterCity: "Munich, Germany",
      chapterDate: expect.any(String),
      response: null,
      respondedAt: null,
    });
  });

  it("carries the standing answer for an already-answered token", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({
        data: { ...LIVE_ROW, response: "yes", responded_at: "2026-10-01T10:00:00.000Z" },
      })
    );
    const result = await getRsvpByToken(TOKEN);
    expect(result?.response).toBe("yes");
    expect(result?.respondedAt).toBe("2026-10-01T10:00:00.000Z");
  });

  it("returns null for an unknown token", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ data: null }));
    expect(await getRsvpByToken(UNKNOWN_TOKEN)).toBeNull();
  });

  it("returns null when the joined application is missing", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ data: { application_id: "app-1", response: null, responded_at: null, applications: null } })
    );
    expect(await getRsvpByToken(TOKEN)).toBeNull();
  });

  it("normalises a to-one join returned as an array", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({
        data: {
          ...LIVE_ROW,
          applications: [
            { first_name: "Ada", chapters: [LIVE_ROW.applications.chapters] },
          ],
        },
      })
    );
    const result = await getRsvpByToken(TOKEN);
    expect(result?.firstName).toBe("Ada");
    expect(result?.chapterName).toBe("Munich Match");
  });

  it("THROWS on a real DB error instead of collapsing to null", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ error: new Error("connection refused") }));
    await expect(getRsvpByToken(TOKEN)).rejects.toThrow("connection refused");
  });

  it("returns null when rate limited, without touching the database", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Too many requests" });
    const db = makeDb({ data: LIVE_ROW });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await getRsvpByToken(TOKEN)).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns null (never throws) for a MALFORMED token, without querying", async () => {
    // Postgres rejects a non-uuid literal in `rsvp_token = ?` rather than
    // matching no rows, and this resolver throws on DB errors, so querying with
    // one rendered a 500 instead of a 404. Mail clients wrap and truncate long
    // URLs, so real recipients arrive with mangled tokens.
    const db = makeDb({ data: LIVE_ROW });
    mocks.createAdminClient.mockReturnValue(db);

    for (const bad of ["garbage", "123", "' OR 1=1--", "09bc21bb-0ec0-4aa1-903a", "../../etc/passwd"]) {
      await expect(getRsvpByToken(bad)).resolves.toBeNull();
    }
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("still accepts a well-formed uuid in either case", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ data: LIVE_ROW }));
    await expect(getRsvpByToken("09BC21BB-0EC0-4AA1-903A-BA5EC01D41D4")).resolves.not.toBeNull();
  });

  it("spends no rate-limit token and no query on an empty token", async () => {
    const db = makeDb({ data: LIVE_ROW });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await getRsvpByToken("")).toBeNull();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});
