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
  mocks.getSession.mockResolvedValue({ profile: ADMIN });
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
