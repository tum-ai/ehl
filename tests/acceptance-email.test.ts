import { describe, it, expect, vi, beforeEach } from "vitest";

// The acceptance email (with the check-in QR) is sent from TWO places: the admin
// bulk send and a Grand Finale invitee clicking "I'm in". lib/acceptance-email.ts
// holds the one implementation both use. This pins the parts that make that
// shared module safe:
//   - acceptance_email_sent_at is stamped ONLY after the send resolves, which is
//     what makes the admin's "send pending emails" button a safety net for a
//     failed send from the invite flow;
//   - a row that already carries the stamp is never mailed twice;
//   - the single-application helper never throws: the invitee's click has
//     already been recorded and must not fail over an email problem.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  renderApplicationAcceptedEmail: vi.fn(),
  getChapterCommunications: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationAcceptedEmail: mocks.renderApplicationAcceptedEmail,
}));
vi.mock("@/lib/queries", () => ({ getChapterCommunications: mocks.getChapterCommunications }));
vi.mock("qrcode", () => ({ default: { toBuffer: mocks.toBuffer } }));

import {
  deliverAcceptanceEmail,
  sendAcceptanceEmailForApplication,
} from "@/lib/acceptance-email";
import { makeDb, writes } from "./finale-invite-helpers";

const CHAPTER = {
  name: "Grand Finale",
  city: "Munich",
  country: "Germany",
  date: "2026-10-10",
  date_end: "2026-10-11",
  slug: "grand-finale",
};

const APP = {
  id: "app-1",
  email: "ada@example.com",
  first_name: "Ada",
  check_in_token: "check-in-token-1",
  chapters: CHAPTER,
};

const NO_CUSTOMISATION = { acceptanceEmailSubject: null, acceptanceEmailMessage: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toBuffer.mockResolvedValue(Buffer.from("qr"));
  mocks.renderApplicationAcceptedEmail.mockResolvedValue("<html></html>");
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.getChapterCommunications.mockResolvedValue(NO_CUSTOMISATION);
});

describe("deliverAcceptanceEmail", () => {
  it("sends the email with the QR attachment and then stamps the application", async () => {
    const { db, calls } = makeDb({ update: { applications: { data: null, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);

    await deliverAcceptanceEmail(APP, NO_CUSTOMISATION);

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        attachments: [expect.objectContaining({ cid: "qr-code" })],
      })
    );
    const update = writes(calls).find((c) => c.table === "applications" && c.op === "update");
    expect(update?.payload).toHaveProperty("acceptance_email_sent_at");
  });

  it("does NOT stamp the application when the send fails", async () => {
    const { db, calls } = makeDb({ update: { applications: { data: null, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));

    await expect(deliverAcceptanceEmail(APP, NO_CUSTOMISATION)).rejects.toThrow("smtp down");
    expect(writes(calls)).toEqual([]);
  });

  it("passes the per-chapter custom message through as paragraphs", async () => {
    const { db } = makeDb({ update: { applications: { data: null, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);

    await deliverAcceptanceEmail(APP, {
      acceptanceEmailSubject: "See you in Munich",
      acceptanceEmailMessage: "First line.\n\nSecond line.",
    });

    expect(mocks.renderApplicationAcceptedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ customMessageParagraphs: ["First line.", "Second line."] })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "See you in Munich" })
    );
  });
});

describe("sendAcceptanceEmailForApplication", () => {
  it("sends for an application that has not been emailed yet", async () => {
    const { db } = makeDb({
      select: { applications: { data: { ...APP, acceptance_email_sent_at: null, chapter_id: "finale-1" }, error: null } },
      update: { applications: { data: null, error: null } },
    });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await sendAcceptanceEmailForApplication("app-1")).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("never sends twice for an application that already carries the stamp", async () => {
    const { db } = makeDb({
      select: {
        applications: {
          data: { ...APP, acceptance_email_sent_at: "2026-09-18T10:00:00Z", chapter_id: "finale-1" },
          error: null,
        },
      },
    });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await sendAcceptanceEmailForApplication("app-1")).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing when the send fails", async () => {
    const { db } = makeDb({
      select: { applications: { data: { ...APP, acceptance_email_sent_at: null, chapter_id: "finale-1" }, error: null } },
      update: { applications: { data: null, error: null } },
    });
    mocks.createAdminClient.mockReturnValue(db);
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));

    expect(await sendAcceptanceEmailForApplication("app-1")).toBe(false);
  });

  it("returns false for a missing application", async () => {
    const { db } = makeDb({ select: { applications: { data: null, error: null } } });
    mocks.createAdminClient.mockReturnValue(db);

    expect(await sendAcceptanceEmailForApplication("nope")).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
