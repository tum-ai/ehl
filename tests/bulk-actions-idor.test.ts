import { describe, it, expect, vi, beforeEach } from "vitest";

// Call-site IDOR tests for bulk application server actions.
//
// Guard functions are tested in isolation in chapter-admin-guards.test.ts.
// These tests verify that the bulk actions reject mixed-chapter arrays even
// when the guard passes (i.e. at least one application belongs to the caller's
// chapter), and that the single-chapter invite enforcement works.

const mocks = vi.hoisted(() => ({
  requireChapterAdminAction: vi.fn(),
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  isAdminEmail: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  QRCode: { toBuffer: vi.fn() },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/admin-allowlist", () => ({ isAdminEmail: mocks.isAdminEmail }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationAcceptedEmail: mocks.renderApplicationAcceptedEmail,
  renderApplicationRejectedEmail: mocks.renderApplicationRejectedEmail,
}));
vi.mock("qrcode", () => ({ default: mocks.QRCode }));

import {
  bulkUpdateApplicationStatus,
  sendAcceptanceEmails,
  sendRejectionEmails,
} from "@/lib/actions/applications";
import { inviteChapterAdmin } from "@/lib/actions/chapter-admins";

const CHAPTER_A = "chapter-a";
const CHAPTER_B = "chapter-b";

// Builds a minimal chainable Supabase builder that returns `rows` from `.then()`
// and `rows[0]` from `.single()` / `.maybeSingle()`.
function makeDb(rows: unknown[]) {
  return {
    from(_table: string) {
      const builder = {
        select: () => builder,
        insert: () => builder,
        upsert: () => builder,
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(onF),
      };
      return builder;
    },
    auth: { admin: { createUser: vi.fn(), generateLink: vi.fn() } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // By default guard passes — simulates a chapter-A admin.
  mocks.requireChapterAdminAction.mockResolvedValue(null);
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.isAdminEmail.mockResolvedValue(false);
});

// ─── bulkUpdateApplicationStatus ─────────────────────────────────────────────

describe("bulkUpdateApplicationStatus", () => {
  it("rejects a mixed-chapter array even when the first row belongs to the caller's chapter", async () => {
    const apps = [
      { id: "app-a1", chapter_id: CHAPTER_A, acceptance_email_sent_at: null, rejection_email_sent_at: null },
      { id: "app-b1", chapter_id: CHAPTER_B, acceptance_email_sent_at: null, rejection_email_sent_at: null },
    ];
    mocks.createAdminClient.mockReturnValue(makeDb(apps));

    const result = await bulkUpdateApplicationStatus(["app-a1", "app-b1"], "accepted");

    expect(result.error).toMatch(/same chapter/i);
  });

  it("proceeds when all applications belong to the same chapter", async () => {
    const apps = [
      { id: "app-a1", chapter_id: CHAPTER_A, acceptance_email_sent_at: null, rejection_email_sent_at: null },
      { id: "app-a2", chapter_id: CHAPTER_A, acceptance_email_sent_at: null, rejection_email_sent_at: null },
    ];
    // Second call (the update) returns no error.
    const db = {
      from(_table: string) {
        let callCount = 0;
        const builder = {
          select: () => builder,
          update: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (onF: (v: unknown) => unknown) => {
            callCount++;
            const data = callCount === 1 ? apps : [];
            return Promise.resolve({ data, error: null }).then(onF);
          },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return builder;
      },
    };
    mocks.createAdminClient.mockReturnValue(db);

    const result = await bulkUpdateApplicationStatus(["app-a1", "app-a2"], "accepted");

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

// ─── sendAcceptanceEmails ─────────────────────────────────────────────────────

describe("sendAcceptanceEmails", () => {
  it("rejects a mixed-chapter array", async () => {
    const apps = [
      { id: "app-a1", chapter_id: CHAPTER_A, status: "accepted", acceptance_email_sent_at: null, chapters: { name: "A", city: "Munich", country: "Germany", date: "2026-01-01", date_end: null, slug: "a" } },
      { id: "app-b1", chapter_id: CHAPTER_B, status: "accepted", acceptance_email_sent_at: null, chapters: { name: "B", city: "Berlin", country: "Germany", date: "2026-02-01", date_end: null, slug: "b" } },
    ];
    mocks.createAdminClient.mockReturnValue(makeDb(apps));

    const result = await sendAcceptanceEmails(["app-a1", "app-b1"]);

    expect(result.error).toMatch(/same chapter/i);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

// ─── sendRejectionEmails ──────────────────────────────────────────────────────

describe("sendRejectionEmails", () => {
  it("rejects a mixed-chapter array", async () => {
    const apps = [
      { id: "app-a1", chapter_id: CHAPTER_A, status: "rejected", rejection_email_sent_at: null, chapters: { name: "A", city: "Munich", country: "Germany", date: "2026-01-01", date_end: null } },
      { id: "app-b1", chapter_id: CHAPTER_B, status: "rejected", rejection_email_sent_at: null, chapters: { name: "B", city: "Berlin", country: "Germany", date: "2026-02-01", date_end: null } },
    ];
    mocks.createAdminClient.mockReturnValue(makeDb(apps));

    const result = await sendRejectionEmails(["app-a1", "app-b1"]);

    expect(result.error).toMatch(/same chapter/i);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

// ─── inviteChapterAdmin — single-chapter enforcement ─────────────────────────

describe("inviteChapterAdmin — second-chapter rejection", () => {
  it("rejects an invite when the person is already a local admin of a different chapter", async () => {
    // DB: chapter exists, profile exists, chapter_admins has one row for CHAPTER_B
    let tableCall = "";
    const client = {
      from(table: string) {
        tableCall = table;
        const builder = {
          select: () => builder,
          upsert: () => builder,
          insert: (_p: unknown) => Promise.resolve({ error: null }),
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => builder,
          single: () => {
            if (table === "chapters") return Promise.resolve({ data: { id: CHAPTER_A }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          maybeSingle: () => {
            if (table === "profiles") return Promise.resolve({ data: { id: "user-1" }, error: null });
            // chapter_admins: this person already admins CHAPTER_B
            if (table === "chapter_admins") return Promise.resolve({ data: { chapter_id: CHAPTER_B }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return builder;
      },
      auth: { admin: { createUser: vi.fn(), generateLink: vi.fn() } },
    };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });

    const result = await inviteChapterAdmin("partner@external.com", "Partner", CHAPTER_A);

    expect(result.error).toMatch(/already a local admin for another chapter/i);
  });

  it("rejects an invite when the person is already a local admin of the same chapter", async () => {
    const client = {
      from(table: string) {
        const builder = {
          select: () => builder,
          upsert: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          single: () => {
            if (table === "chapters") return Promise.resolve({ data: { id: CHAPTER_A }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          maybeSingle: () => {
            if (table === "profiles") return Promise.resolve({ data: { id: "user-1" }, error: null });
            if (table === "chapter_admins") return Promise.resolve({ data: { chapter_id: CHAPTER_A }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return builder;
      },
      auth: { admin: { createUser: vi.fn(), generateLink: vi.fn() } },
    };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    });

    const result = await inviteChapterAdmin("partner@external.com", "Partner", CHAPTER_A);

    expect(result.error).toMatch(/already a local admin for this chapter/i);
  });
});
