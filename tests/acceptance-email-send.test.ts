import { describe, it, expect, vi, beforeEach } from "vitest";

// Behavioural tests for sendAcceptanceEmails. Until now this action had only
// IDOR coverage, and no test pinned how it handles a large selection at all.
//
// It used to be a sequential loop with NO cap: selecting 85 applicants meant 85
// SMTP round trips plus 85 QR renders inside one request, which can exceed the
// function timeout and die mid-batch. These pin the fixed behaviour:
//   - sends run concurrently, using the pooled SMTP connections;
//   - a wall-clock budget stops the run and reports `remaining`;
//   - already-emailed applicants are never mailed twice;
//   - a recipient the budget skipped is NOT stamped, so a retry reaches them.

const mocks = vi.hoisted(() => ({
  requireChapterAdminAction: vi.fn(),
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getSession: vi.fn(),
  isAdminEmail: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  getChapterCommunications: vi.fn(),
  QRCode: { toBuffer: vi.fn() },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/admin-allowlist", () => ({ isAdminEmail: mocks.isAdminEmail }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationAcceptedEmail: mocks.renderApplicationAcceptedEmail,
  renderApplicationRejectedEmail: mocks.renderApplicationRejectedEmail,
}));
vi.mock("@/lib/queries", () => ({ getChapterCommunications: mocks.getChapterCommunications }));
vi.mock("qrcode", () => ({ default: mocks.QRCode }));

import {
  sendAcceptanceEmails,
  sendRejectionEmails,
  sendBulkEmails,
} from "@/lib/actions/applications";

const CHAPTER = "chapter-a";

function application(id: string, opts: { alreadySent?: boolean } = {}) {
  return {
    id,
    chapter_id: CHAPTER,
    email: `${id}@example.com`,
    first_name: "Ada",
    check_in_token: `token-${id}`,
    acceptance_email_sent_at: opts.alreadySent ? "2026-01-01T00:00:00.000Z" : null,
    rejection_email_sent_at: opts.alreadySent ? "2026-01-01T00:00:00.000Z" : null,
    chapters: { name: "Munich Match", city: "Munich", country: "Germany", date: "2026-11-14", date_end: null },
  };
}

/** Records the id of every application stamped as emailed. */
function makeDb(rows: unknown[]) {
  const stamped: string[] = [];
  const db = {
    from(_table: string) {
      let filterId: string | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          if (payload.acceptance_email_sent_at) builder._stamping = true;
          return builder;
        },
        eq: (_col: string, val: string) => {
          filterId = val;
          if (builder._stamping && filterId) stamped.push(filterId);
          return builder;
        },
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF),
      };
      return builder;
    },
  };
  return { db, stamped };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireChapterAdminAction.mockResolvedValue(null);
  mocks.getChapterCommunications.mockResolvedValue({
    acceptanceEmailSubject: null,
    acceptanceEmailMessage: null,
  });
  mocks.renderApplicationAcceptedEmail.mockResolvedValue("<html></html>");
  mocks.QRCode.toBuffer.mockResolvedValue(Buffer.from("qr"));
  mocks.sendEmail.mockResolvedValue(undefined);
});

describe("sendAcceptanceEmails", () => {
  it("mails a large selection in one call", async () => {
    const rows = Array.from({ length: 85 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendAcceptanceEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 85, remaining: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(85);
  });

  it("sends concurrently rather than one at a time", async () => {
    // The old sequential loop left the 3-connection pool in lib/email.ts idle.
    let inFlight = 0;
    let peak = 0;
    mocks.sendEmail.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
    });

    const rows = Array.from({ length: 12 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    await sendAcceptanceEmails(rows.map((r) => r.id));

    expect(peak).toBeGreaterThan(1);
  });

  it("never re-mails someone already emailed", async () => {
    const rows = [
      application("a0", { alreadySent: true }),
      application("a1", { alreadySent: true }),
      application("a2"),
    ];
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendAcceptanceEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 1, remaining: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "a2@example.com" }));
  });

  it("stops at the wall-clock budget and reports the rest as remaining", async () => {
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const rows = Array.from({ length: 10 }, (_, i) => application(`a${i}`));
      const { db } = makeDb(rows);
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendAcceptanceEmails(rows.map((r) => r.id));

      const r = result as { success: true; sent: number; remaining: number };
      expect(r.sent).toBeGreaterThan(0);
      expect(r.sent).toBeLessThan(10);
      expect(r.sent + r.remaining).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT stamp a recipient the budget skipped, so a retry reaches them", async () => {
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const rows = Array.from({ length: 10 }, (_, i) => application(`a${i}`));
      const { db, stamped } = makeDb(rows);
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendAcceptanceEmails(rows.map((r) => r.id));

      // Exactly the ones actually mailed are stamped as emailed.
      expect(stamped.length).toBe((result as { sent: number }).sent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed address without stopping the rest of the run", async () => {
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "a1@example.com") throw new Error("smtp down");
    });

    const rows = Array.from({ length: 4 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendAcceptanceEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 3 });
    expect((result as { error?: string }).error).toContain("a1@example.com");
  });

  it("refuses a chapter the caller does not administer, before sending", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue("Forbidden");
    const rows = [application("a0")];
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    expect(await sendAcceptanceEmails(["a0"])).toEqual({ error: "Forbidden" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendRejectionEmails", () => {
  beforeEach(() => {
    mocks.renderApplicationRejectedEmail.mockResolvedValue("<html></html>");
  });

  it("mails a large selection in one call", async () => {
    const rows = Array.from({ length: 85 }, (_, i) => application(`r${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRejectionEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 85, remaining: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(85);
  });

  it("sends concurrently rather than one at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    mocks.sendEmail.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
    });

    const rows = Array.from({ length: 12 }, (_, i) => application(`r${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    await sendRejectionEmails(rows.map((r) => r.id));

    expect(peak).toBeGreaterThan(1);
  });

  it("never re-mails someone already emailed", async () => {
    const rows = [application("r0", { alreadySent: true }), application("r1")];
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRejectionEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 1 });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "r1@example.com" }));
  });

  it("REPORTS a failed address instead of swallowing it", async () => {
    // Failures used to be console.error'd and dropped: the admin saw a plain
    // success count and never learned an address had bounced.
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "r1@example.com") throw new Error("smtp down");
    });

    const rows = Array.from({ length: 3 }, (_, i) => application(`r${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRejectionEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 2 });
    expect((result as { error?: string }).error).toContain("r1@example.com");
  });

  it("a render failure fails only that applicant, not the whole run", async () => {
    // Rendering used to sit outside the try, so one bad template threw out of
    // the action and abandoned every remaining applicant.
    mocks.renderApplicationRejectedEmail.mockImplementation(async ({ firstName }: { firstName: string }) => {
      void firstName;
      if (mocks.renderApplicationRejectedEmail.mock.calls.length === 1) {
        throw new Error("template blew up");
      }
      return "<html></html>";
    });

    const rows = Array.from({ length: 4 }, (_, i) => application(`r${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendRejectionEmails(rows.map((r) => r.id));

    expect(result).toMatchObject({ success: true, sent: 3 });
  });

  it("stops at the wall-clock budget and reports the rest as remaining", async () => {
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const rows = Array.from({ length: 10 }, (_, i) => application(`r${i}`));
      const { db } = makeDb(rows);
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendRejectionEmails(rows.map((r) => r.id));

      const r = result as { sent: number; remaining: number };
      expect(r.sent).toBeGreaterThan(0);
      expect(r.sent).toBeLessThan(10);
      expect(r.sent + r.remaining).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the shared send budget", () => {
  it("CLAMPS a caller-supplied budget to the default", async () => {
    // These are exported server actions, so a forged client request could
    // otherwise ask for an arbitrarily long-running function.
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockImplementation(async () => {
        vi.advanceTimersByTime(20_000);
      });

      const rows = Array.from({ length: 10 }, (_, i) => application(`a${i}`));
      const { db } = makeDb(rows);
      mocks.createAdminClient.mockReturnValue(db);

      const result = await sendAcceptanceEmails(
        rows.map((r) => r.id),
        { budgetMs: 10_000_000 }
      );

      // Honouring the request would have sent all 10; the clamp stops it early.
      expect((result as { sent: number }).sent).toBeLessThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the default for a nonsense budget", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendAcceptanceEmails(
      rows.map((r) => r.id),
      { budgetMs: -1 }
    );

    expect(result).toMatchObject({ success: true, sent: 3 });
  });
});

describe("sendBulkEmails", () => {
  it("no longer caps at 40 per press", async () => {
    // It used to slice the pending set to 40 and tell the admin to click again,
    // so 85 accepted applicants took three presses.
    const rows = Array.from({ length: 85 }, (_, i) => application(`a${i}`));
    const { db } = makeDb(rows);
    mocks.createAdminClient.mockReturnValue(db);

    const result = await sendBulkEmails(CHAPTER);

    expect(result.acceptedSent).toBe(85);
  });
});
