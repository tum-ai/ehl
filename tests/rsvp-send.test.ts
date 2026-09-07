import { describe, it, expect, vi, beforeEach } from "vitest";

// sendRsvpEmails is the admin "ask everyone accepted" button. This test pins:
//   - it is idempotent: an applicant who already has an RSVP row (already
//     asked) is never mailed again, so pressing the button twice is safe;
//   - only accepted applicants are asked;
//   - ONE press mails everyone: there is no fixed chunk, so 85 accepted
//     applicants go out in a single click (this replaced a 40-per-press cap
//     copied from sendBulkEmails, which made an admin click three times);
//   - sends run concurrently, matching the SMTP pool, rather than one at a time;
//   - a wall-clock budget stops the run before the function timeout and reports
//     the rest as `remaining`, leaving NO row behind for anyone not reached;
//   - a send failure ROLLS BACK that applicant's row, so a retry re-sends
//     instead of silently marking them as asked;
//   - the token mailed out is the one the freshly inserted row generated.

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

const CHAPTER = {
  name: "Munich Match",
  city: "Munich",
  country: "Germany",
  date: "2026-11-14",
  date_end: null,
};

function application(id: string, opts: { asked?: boolean } = {}) {
  return {
    id,
    email: `${id}@example.com`,
    first_name: "Ada",
    chapters: CHAPTER,
    application_rsvps: opts.asked ? [{ application_id: id }] : [],
  };
}

interface Recorded {
  table: string;
  op: "select" | "insert" | "delete";
  payload?: Record<string, unknown>;
}

/** Supabase mock whose query builder is thenable, as the real one is. */
function makeDb(accepted: unknown[], opts: { insertFails?: Set<string> } = {}) {
  const calls: Recorded[] = [];
  let tokenSeq = 0;

  const from = vi.fn((table: string) => {
    const rec: Recorded = { table, op: "select" };
    const result = () => {
      if (rec.op === "insert") {
        const appId = rec.payload?.application_id as string;
        if (opts.insertFails?.has(appId)) {
          return { data: null, error: new Error("insert failed") };
        }
        return { data: { rsvp_token: `token-${++tokenSeq}` }, error: null };
      }
      return { data: accepted, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      limit: () => builder,
      insert: (payload: Record<string, unknown>) => {
        rec.op = "insert";
        rec.payload = payload;
        calls.push(rec);
        return builder;
      },
      delete: () => {
        rec.op = "delete";
        calls.push(rec);
        return builder;
      },
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      // Awaiting the builder directly (the `.limit()` and `.delete().eq()` cases).
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === "select") calls.push(rec);
        return Promise.resolve(result()).then(resolve);
      },
    };
    return builder;
  });

  return { db: { from }, calls };
}

/** Narrows the discriminated union, failing loudly if the action errored. */
function ok<T extends object>(result: { error: string } | T): T {
  if ("error" in result) throw new Error(`Expected success, got error: ${result.error}`);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireChapterAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
  mocks.renderRsvpRequestEmail.mockResolvedValue("<html></html>");
  mocks.sendEmail.mockResolvedValue(undefined);
});

describe("sendRsvpEmails", () => {
  it("mails every accepted applicant who has not been asked yet", async () => {
    const { db } = makeDb([application("a"), application("b")]);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("chapter-1");

    expect(result).toEqual({ success: true, sent: 2, remaining: 0, failed: [] });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("skips applicants who already have an RSVP row, so a second press mails nobody", async () => {
    const { db } = makeDb([application("a", { asked: true }), application("b", { asked: true })]);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("chapter-1");

    expect(result).toEqual({ success: true, sent: 0, remaining: 0, failed: [] });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("mails only the not-yet-asked applicants in a mixed chapter", async () => {
    const { db } = makeDb([application("a", { asked: true }), application("b")]);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("chapter-1");

    expect(ok(result).sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "b@example.com" })
    );
  });

  it("mails EVERYONE in a single press, with no fixed chunk", async () => {
    // The behaviour this replaced capped at 40, so 85 accepted applicants took
    // three clicks. One press must now reach all of them.
    const many = Array.from({ length: 85 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(many);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("chapter-1");

    expect(result).toEqual({ success: true, sent: 85, remaining: 0, failed: [] });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(85);
  });

  it("sends concurrently rather than one at a time", async () => {
    // lib/email.ts opens a pool with maxConnections: 3; a sequential await loop
    // would only ever use one of them.
    let inFlight = 0;
    let peak = 0;
    mocks.sendEmail.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
    });

    const { db } = makeDb(Array.from({ length: 12 }, (_, i) => application(`a${i}`)));
    mocks.createAdminClient.mockReturnValue(db);

    await sendRsvpEmails("chapter-1");

    expect(peak).toBeGreaterThan(1);
  });

  it("mails the token generated by the row it just inserted", async () => {
    const { db } = makeDb([application("a")]);
    mocks.createAdminClient.mockReturnValue(db);

    await sendRsvpEmails("chapter-1");

    expect(mocks.renderRsvpRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ rsvpToken: "token-1", firstName: "Ada", chapterName: "Munich Match" })
    );
  });

  it("rolls the row back when the send throws, so a retry re-sends", async () => {
    const { db, calls } = makeDb([application("a")]);
    mocks.createAdminClient.mockReturnValue(db);
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));

    const result = await sendRsvpEmails("chapter-1");

    expect(result).toEqual({ success: true, sent: 0, remaining: 0, failed: ["a@example.com"] });
    expect(calls.some((c) => c.op === "delete" && c.table === "application_rsvps")).toBe(true);
  });

  it("reports an applicant whose row could not be inserted, without mailing them", async () => {
    const { db } = makeDb([application("a"), application("b")], { insertFails: new Set(["a"]) });
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRsvpEmails("chapter-1");

    expect(ok(result).failed).toEqual(["a@example.com"]);
    expect(ok(result).sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("logs one audit event for the batch when anything was sent", async () => {
    const { db } = makeDb([application("a")]);
    mocks.createAdminClient.mockReturnValue(db);

    await sendRsvpEmails("chapter-1");

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application.rsvp_requested",
        entityId: "chapter-1",
        actorId: "admin-1",
        actorType: "admin",
      })
    );
  });

  it("stops at the wall-clock budget and reports the rest as remaining", async () => {
    vi.useFakeTimers();
    try {
      // Each send burns 20s of the 45s budget, so only the first few land.
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const { db } = makeDb(Array.from({ length: 10 }, (_, i) => application(`a${i}`)));
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendRsvpEmails("chapter-1");

      const r = ok(result);
      expect(r.sent).toBeGreaterThan(0);
      expect(r.sent).toBeLessThan(10);
      // Nobody is lost: everyone is either sent, failed, or reported remaining.
      expect(r.sent + r.failed.length + r.remaining).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves NO row behind for recipients the budget did not reach", async () => {
    // A row means "already asked", so a stranded row would silently exclude
    // that person from every future press.
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const { db, calls } = makeDb(Array.from({ length: 10 }, (_, i) => application(`a${i}`)));
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendRsvpEmails("chapter-1");

      const inserts = calls.filter((c) => c.op === "insert").length;
      expect(inserts).toBe(ok(result).sent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs nothing when there was nobody to ask", async () => {
    const { db } = makeDb([]);
    mocks.createAdminClient.mockReturnValue(db);

    await sendRsvpEmails("chapter-1");

    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
