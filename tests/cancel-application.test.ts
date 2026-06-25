import { describe, it, expect, vi, beforeEach } from "vitest";

// cancelApplication / addApplicationNote are the new admin path for handling an
// accepted (and possibly already-emailed) person who can no longer attend. We
// pin: the authorization gate, that a reason is required, that cancelling works
// AFTER the acceptance email was sent (the whole point), the exact DB writes
// (status + cancel columns + a notes row), that the transition is recorded in
// the event_log, and that cancellation is terminal (updateApplicationStatus
// cannot reactivate a cancelled applicant).
const mocks = vi.hoisted(() => ({
  requireChapterAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  getSession: vi.fn(),
  logEvent: vi.fn(),
  sendEmailAfterResponse: vi.fn(),
  renderApplicationCancelledEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: mocks.requireChapterAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email-deferred", () => ({
  sendEmailAfterResponse: mocks.sendEmailAfterResponse,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationReceivedEmail: vi.fn(),
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  renderApplicationCancelledEmail: mocks.renderApplicationCancelledEmail,
}));
// Avoid pulling Drive/QR/turnstile/ratelimit ESM into the test.
vi.mock("@/lib/gdrive", () => ({ uploadFile: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toBuffer: vi.fn() } }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  applicationLimiter: {},
  apiLimiter: {},
}));

import {
  cancelApplication,
  addApplicationNote,
  updateApplicationStatus,
  bulkUpdateApplicationStatus,
} from "@/lib/actions/applications";

const APP_ID = "app-1";
const CHAPTER = "chapter-a";
const ADMIN = { id: "admin-1", email: "admin@tum-ai.com" };

// Minimal chainable Supabase mock mirroring chapter-admins-actions.test.ts.
function makeAdminClient(opts: {
  responder: (s: {
    table: string;
    op: string;
    filters: [string, unknown][];
    payload: unknown;
  }) => unknown;
  calls: Array<{ table: string; op: string; payload: unknown }>;
}) {
  function makeBuilder() {
    const state = {
      table: "",
      op: "select",
      filters: [] as [string, unknown][],
      payload: null as unknown,
    };
    const resolve = () => {
      opts.calls.push({ table: state.table, op: state.op, payload: state.payload });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: () => ((state.op = "select"), builder),
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      order: () => resolve(),
      limit: () => builder,
      single: () => resolve(),
      maybeSingle: () => resolve(),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        resolve().then(onF, onR),
    };
    return { builder, state };
  }
  return {
    from(table: string) {
      const { builder, state } = makeBuilder();
      state.table = table;
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireChapterAdminAction.mockResolvedValue(null); // authorized by default
  // getSession returns both user and profile; the acting admin id (used for audit
  // attribution + cancelled_by/author_id) now comes from session.user.id.
  mocks.getSession.mockResolvedValue({ user: { id: ADMIN.id }, profile: ADMIN });
});

describe("cancelApplication", () => {
  it("requires a reason", async () => {
    const result = await cancelApplication(APP_ID, "   ");
    expect(result.error).toMatch(/reason is required/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not an admin for the chapter", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue("Admin access required.");
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return { data: { id: APP_ID, status: "accepted", chapter_id: CHAPTER, chapters: {} } };
          return { data: null, error: null };
        },
      })
    );
    const result = await cancelApplication(APP_ID, "cannot attend");
    expect(result).toEqual({ error: "Admin access required." });
  });

  it("does not leak application existence: unauthorized caller gets the same auth error whether the row exists or not", async () => {
    // Guard rejects (unauthorized). Whether the application row exists or not,
    // the caller must get the generic auth error, never "Application not found",
    // so the action is not an existence oracle.
    mocks.requireChapterAdminAction.mockResolvedValue("Admin access required.");

    // Existing row.
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) =>
          table === "applications" && op === "select"
            ? { data: { id: APP_ID, status: "accepted", chapter_id: CHAPTER, chapters: {} } }
            : { data: null, error: null },
      })
    );
    const existing = await cancelApplication(APP_ID, "x");

    // Missing row.
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls: [], responder: () => ({ data: null }) })
    );
    const missing = await cancelApplication("does-not-exist", "x");

    expect(existing).toEqual({ error: "Admin access required." });
    expect(missing).toEqual({ error: "Admin access required." });
  });

  it("cancels an accepted+emailed applicant, writing cancel columns and a note", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return {
              data: {
                id: APP_ID,
                status: "accepted",
                chapter_id: CHAPTER,
                first_name: "Abdallah",
                email: "a@example.com",
                acceptance_email_sent_at: "2026-06-01T00:00:00Z",
                chapters: { name: "Paris", city: "Paris", country: "France", date: "2026-07-01", date_end: null },
              },
            };
          return { data: null, error: null };
        },
      })
    );

    const result = await cancelApplication(APP_ID, "  emailed they can't come  ");
    expect(result).toEqual({ success: true });

    const update = calls.find((c) => c.table === "applications" && c.op === "update");
    expect(update?.payload).toMatchObject({
      status: "cancelled",
      cancelled_by: ADMIN.id,
      cancel_reason: "emailed they can't come",
    });
    expect((update?.payload as { cancelled_at: string }).cancelled_at).toBeTruthy();

    const note = calls.find((c) => c.table === "application_notes" && c.op === "insert");
    expect(note?.payload).toMatchObject({
      application_id: APP_ID,
      author_id: ADMIN.id,
      author_email: ADMIN.email,
    });
    expect((note?.payload as { body: string }).body).toContain("emailed they can't come");
    expect((note?.payload as { body: string }).body).toContain("accepted");

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.cancelled" })
    );
    // No email requested -> none queued.
    expect(mocks.sendEmailAfterResponse).not.toHaveBeenCalled();
  });

  it("queues a confirmation email only when requested", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return {
              data: {
                id: APP_ID,
                status: "accepted",
                chapter_id: CHAPTER,
                first_name: "Abdallah",
                email: "a@example.com",
                chapters: { name: "Paris", city: "Paris", country: "France", date: "2026-07-01", date_end: null },
              },
            };
          return { data: null, error: null };
        },
      })
    );

    const result = await cancelApplication(APP_ID, "cannot attend", true);
    expect(result).toEqual({ success: true });
    expect(mocks.sendEmailAfterResponse).toHaveBeenCalledTimes(1);
  });

  it("removes the cancelled person from a roster that stays at/above the minimum", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return {
              data: {
                id: APP_ID,
                status: "checked_in",
                chapter_id: CHAPTER,
                first_name: "Abdallah",
                email: "a@example.com",
                chapters: {},
              },
            };
          if (table === "profiles" && op === "select")
            return { data: { id: "user-abdallah" } };
          // reg-1 has 3 members -> removing one leaves 2 (>= min), so it is updated.
          // reg-2 does not contain the user, so it is untouched.
          if (table === "challenge_registrations" && op === "select")
            return {
              data: [
                { id: "reg-1", roster: ["user-abdallah", "user-keep", "user-keep2"] },
                { id: "reg-2", roster: ["user-other", "user-other2"] },
              ],
            };
          return { data: null, error: null };
        },
      })
    );

    const result = await cancelApplication(APP_ID, "cannot attend Paris");
    expect(result).toEqual({ success: true });

    const regUpdates = calls.filter(
      (c) => c.table === "challenge_registrations" && c.op === "update"
    );
    expect(regUpdates).toHaveLength(1);
    expect((regUpdates[0].payload as { roster: string[] }).roster).toEqual([
      "user-keep",
      "user-keep2",
    ]);
    // No deletion, since the roster stayed at the minimum.
    expect(
      calls.filter((c) => c.table === "challenge_registrations" && c.op === "delete")
    ).toHaveLength(0);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application.cancelled",
        delta: expect.objectContaining({ rosters_updated: 1, registrations_removed: 0 }),
      })
    );
  });

  it("deletes a registration that would fall below the roster minimum", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return {
              data: {
                id: APP_ID,
                status: "checked_in",
                chapter_id: CHAPTER,
                email: "a@example.com",
                chapters: {},
              },
            };
          if (table === "profiles" && op === "select")
            return { data: { id: "user-abdallah" } };
          // A two-person roster: removing the cancelled member leaves 1 (< min),
          // so the whole registration must be deleted, not shrunk.
          if (table === "challenge_registrations" && op === "select")
            return { data: [{ id: "reg-1", roster: ["user-abdallah", "user-solo"] }] };
          return { data: null, error: null };
        },
      })
    );

    const result = await cancelApplication(APP_ID, "cannot attend");
    expect(result).toEqual({ success: true });

    // Deleted, not updated.
    expect(
      calls.filter((c) => c.table === "challenge_registrations" && c.op === "delete")
    ).toHaveLength(1);
    expect(
      calls.filter((c) => c.table === "challenge_registrations" && c.op === "update")
    ).toHaveLength(0);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: expect.objectContaining({ rosters_updated: 0, registrations_removed: 1 }),
      })
    );
  });

  it("skips roster cleanup when the email has no matching profile", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return {
              data: { id: APP_ID, status: "accepted", chapter_id: CHAPTER, email: "ghost@example.com", chapters: {} },
            };
          if (table === "profiles" && op === "select") return { data: null };
          return { data: null, error: null };
        },
      })
    );

    const result = await cancelApplication(APP_ID, "cannot attend");
    expect(result).toEqual({ success: true });
    // No profile -> never even queries challenge_registrations.
    expect(calls.some((c) => c.table === "challenge_registrations")).toBe(false);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ delta: expect.objectContaining({ rosters_updated: 0 }) })
    );
  });

  it("refuses to cancel an already-cancelled applicant", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return { data: { id: APP_ID, status: "cancelled", chapter_id: CHAPTER, chapters: {} } };
          return { data: null, error: null };
        },
      })
    );
    const result = await cancelApplication(APP_ID, "again");
    expect(result.error).toMatch(/already cancelled/i);
  });

  it("refuses to cancel a non-attending applicant (pending/rejected/waitlisted)", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return { data: { id: APP_ID, status: "pending", chapter_id: CHAPTER, chapters: {} } };
          return { data: null, error: null };
        },
      })
    );
    const result = await cancelApplication(APP_ID, "should not work");
    expect(result.error).toMatch(/only accepted or checked-in/i);
    // Nothing written.
    expect(calls.find((c) => c.table === "applications" && c.op === "update")).toBeUndefined();
    expect(calls.find((c) => c.table === "application_notes")).toBeUndefined();
  });
});

describe("generic status actions reject the cancelled value", () => {
  it("updateApplicationStatus refuses status='cancelled' (must use cancel action)", async () => {
    const result = await updateApplicationStatus(APP_ID, "cancelled");
    expect(result.error).toMatch(/use the cancel action/i);
    // Rejected before touching the DB at all.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("bulkUpdateApplicationStatus refuses status='cancelled'", async () => {
    const result = await bulkUpdateApplicationStatus([APP_ID], "cancelled");
    expect(result.error).toMatch(/use the cancel action/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("updateApplicationStatus terminal-cancel guard", () => {
  it("refuses to reactivate a cancelled applicant (no email timestamps set)", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            // Cancelled from "accepted" before any email went out: neither
            // acceptance_email_sent_at nor rejection_email_sent_at is set, so the
            // email lock alone would not catch this.
            return {
              data: {
                status: "cancelled",
                chapter_id: CHAPTER,
                acceptance_email_sent_at: null,
                rejection_email_sent_at: null,
              },
            };
          return { data: null, error: null };
        },
      })
    );

    const result = await updateApplicationStatus(APP_ID, "accepted");
    expect(result.error).toMatch(/cancelled applications cannot be reactivated/i);

    // The status must NOT have been written.
    const update = calls.find((c) => c.table === "applications" && c.op === "update");
    expect(update).toBeUndefined();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});

describe("addApplicationNote", () => {
  it("rejects an empty note", async () => {
    const result = await addApplicationNote(APP_ID, "  ");
    expect(result.error).toMatch(/empty/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("inserts the note with author info and logs the event", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return { data: { chapter_id: CHAPTER } };
          return { data: null, error: null };
        },
      })
    );
    const result = await addApplicationNote(APP_ID, "  called him, will confirm tomorrow  ");
    expect(result).toEqual({ success: true });

    const note = calls.find((c) => c.table === "application_notes" && c.op === "insert");
    expect(note?.payload).toMatchObject({
      application_id: APP_ID,
      author_id: ADMIN.id,
      author_email: ADMIN.email,
      body: "called him, will confirm tomorrow",
    });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.note_added" })
    );
  });

  it("rejects a caller who is not an admin for the chapter", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue("Admin access required.");
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "applications" && op === "select")
            return { data: { chapter_id: CHAPTER } };
          return { data: null, error: null };
        },
      })
    );
    const result = await addApplicationNote(APP_ID, "note");
    expect(result).toEqual({ error: "Admin access required." });
  });
});
