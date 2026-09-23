import { describe, it, expect, vi, beforeEach } from "vitest";

// respondToFinaleInvite is the click behind "I'm in" / "I'm out". This pins:
//   - "I'm in" IS the application: it creates an ACCEPTED application for the
//     Finale chapter, with the identity copied from the person's most recent
//     application, and triggers the acceptance email with the QR code;
//   - an existing pending/waitlisted/rejected application is PROMOTED rather
//     than duplicated (applications is unique per chapter+email);
//   - an already accepted application is left alone, so nobody gets a second
//     acceptance email;
//   - a CANCELLED application is never revived by a public link;
//   - the first answer is final: a second click reports the standing answer and
//     writes nothing;
//   - "I'm out" creates no application at all;
//   - a malformed token is refused before the database is touched.

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

import { respondToFinaleInvite } from "@/lib/actions/finale-invites";
import { makeDb, writes, ok, type RecordedCall } from "./finale-invite-helpers";

const TOKEN = "09bc21bb-0ec0-4aa1-903a-ba5ec01d41d4";

const CLAIMED = {
  id: "invite-1",
  chapter_id: "finale-1",
  team_id: "team-a",
  user_id: "u1",
  email: "ada@example.com",
};

const PREVIOUS_APPLICATION = {
  first_name: "Ada",
  last_name: "Lovelace",
  form_data: { university: "TUM", tshirtSize: "M" },
  cv_url: "drive-file-1",
  consent_attendance: true,
  consent_privacy: true,
  consent_newsletter: true,
  consent_recruiting: false,
  consent_media: true,
};

/**
 * The action reads finale_invites (update ... returning), then applications
 * (existing row, then the previous application), then profiles. The stub serves
 * one queued result per applications SELECT so both reads can differ.
 */
function db(opts: {
  claimed?: unknown;
  standing?: unknown;
  existingApp?: unknown;
  previousApp?: unknown;
  profile?: unknown;
  insertFails?: boolean;
}) {
  const appSelects = [
    { data: opts.existingApp ?? null, error: null },
    { data: opts.previousApp === undefined ? PREVIOUS_APPLICATION : opts.previousApp, error: null },
  ];
  return makeDb({
    select: {
      applications: () => appSelects.shift() ?? { data: null, error: null },
      profiles: { data: opts.profile ?? { name: "Ada Lovelace" }, error: null },
      finale_invites: { data: opts.standing ?? null, error: null },
    },
    update: {
      finale_invites: {
        data: opts.claimed === undefined ? CLAIMED : opts.claimed,
        error: null,
      },
      applications: { data: null, error: null },
    },
    insert: {
      applications: opts.insertFails
        ? { data: null, error: new Error("insert failed") }
        : { data: { id: "app-new" }, error: null },
    },
  });
}

function inserted(calls: RecordedCall[]) {
  return writes(calls).find((c) => c.table === "applications" && c.op === "insert")?.payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue({ get: () => "127.0.0.1" });
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  // Run deferred email tasks inline so the test can assert on them.
  mocks.sendEmailAfterResponse.mockImplementation((_label: string, task: () => Promise<unknown>) =>
    task()
  );
  mocks.sendAcceptanceEmailForApplication.mockResolvedValue(true);
});

describe("respondToFinaleInvite: I'm in", () => {
  it("creates an accepted application and sends the acceptance email", async () => {
    const { db: client, calls } = db({});
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "yes"));

    expect(result).toMatchObject({ response: "yes", alreadyAnswered: false, accepted: true });
    expect(inserted(calls)).toMatchObject({
      chapter_id: "finale-1",
      email: "ada@example.com",
      status: "accepted",
      existing_team_id: "team-a",
    });
    expect(mocks.sendAcceptanceEmailForApplication).toHaveBeenCalledWith("app-new");
  });

  it("copies name, form answers and optional consents from the previous application", async () => {
    const { db: client, calls } = db({});
    mocks.createAdminClient.mockReturnValue(client);

    await respondToFinaleInvite(TOKEN, "yes");

    expect(inserted(calls)).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      form_data: { university: "TUM", tshirtSize: "M" },
      cv_url: "drive-file-1",
      consent_newsletter: true,
      consent_recruiting: false,
      consent_media: true,
      // The click itself is the attendance and privacy consent.
      consent_attendance: true,
      consent_privacy: true,
    });
  });

  it("falls back to the profile name when the person never applied before", async () => {
    const { db: client, calls } = db({ previousApp: null, profile: { name: "Grace Hopper" } });
    mocks.createAdminClient.mockReturnValue(client);

    await respondToFinaleInvite(TOKEN, "yes");

    expect(inserted(calls)).toMatchObject({
      first_name: "Grace",
      last_name: "Hopper",
      form_data: {},
      consent_newsletter: false,
      consent_recruiting: false,
      consent_media: false,
    });
  });

  it("never leaves last_name empty when the profile has a single-word name", async () => {
    const { db: client, calls } = db({ previousApp: null, profile: { name: "Ada" } });
    mocks.createAdminClient.mockReturnValue(client);

    await respondToFinaleInvite(TOKEN, "yes");

    expect(inserted(calls)).toMatchObject({ first_name: "Ada", last_name: "-" });
  });

  it("promotes an existing pending application instead of inserting a second one", async () => {
    const { db: client, calls } = db({ existingApp: { id: "app-1", status: "pending" } });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "yes"));

    expect(result.accepted).toBe(true);
    expect(inserted(calls)).toBeUndefined();
    const update = writes(calls).find((c) => c.table === "applications" && c.op === "update");
    expect(update?.payload).toMatchObject({ status: "accepted" });
  });

  it("leaves an already accepted application untouched and sends no second email", async () => {
    const { db: client, calls } = db({
      existingApp: { id: "app-1", status: "accepted", acceptance_email_sent_at: "2026-09-18" },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "yes"));

    expect(result.accepted).toBe(true);
    expect(writes(calls).some((c) => c.table === "applications")).toBe(false);
    // The email helper is still asked, and it is what refuses to re-send an
    // application that already carries acceptance_email_sent_at.
    expect(mocks.sendAcceptanceEmailForApplication).toHaveBeenCalledWith("app-1");
  });

  it("never revives a cancelled application", async () => {
    const { db: client, calls } = db({ existingApp: { id: "app-1", status: "cancelled" } });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "yes"));

    expect(result.accepted).toBe(false);
    expect(writes(calls).some((c) => c.table === "applications")).toBe(false);
    expect(mocks.sendAcceptanceEmailForApplication).not.toHaveBeenCalled();
  });

  it("keeps the recorded answer when the application could not be created", async () => {
    const { db: client } = db({ insertFails: true });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "yes"));

    expect(result).toMatchObject({ response: "yes", accepted: false });
    expect(mocks.sendAcceptanceEmailForApplication).not.toHaveBeenCalled();
  });
});

describe("respondToFinaleInvite: I'm out", () => {
  it("records the answer and creates no application", async () => {
    const { db: client, calls } = db({});
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "no"));

    expect(result).toMatchObject({ response: "no", accepted: false });
    expect(writes(calls).some((c) => c.table === "applications")).toBe(false);
    expect(mocks.sendAcceptanceEmailForApplication).not.toHaveBeenCalled();
  });
});

describe("respondToFinaleInvite: guards", () => {
  it("reports the standing answer on a second click, and writes nothing more", async () => {
    const { db: client, calls } = db({
      claimed: null,
      standing: { response: "yes", application_id: "app-1" },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await respondToFinaleInvite(TOKEN, "no"));

    expect(result).toMatchObject({ response: "yes", alreadyAnswered: true, accepted: true });
    expect(writes(calls).some((c) => c.table === "applications")).toBe(false);
  });

  it("refuses an unknown token without leaking that it is unknown", async () => {
    const { db: client } = db({ claimed: null, standing: null });
    mocks.createAdminClient.mockReturnValue(client);

    expect(await respondToFinaleInvite(TOKEN, "yes")).toEqual({ error: "Invalid invite link." });
  });

  it("refuses a malformed token before touching the database", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("database must not be touched");
    });

    expect(await respondToFinaleInvite("not-a-uuid", "yes")).toEqual({
      error: "Invalid invite link.",
    });
  });

  it("refuses a response that is neither yes nor no", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("database must not be touched");
    });

    expect(
      await respondToFinaleInvite(TOKEN, "maybe" as unknown as "yes")
    ).toEqual({ error: "Invalid response." });
  });

  it("refuses when the rate limiter trips", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Too many requests." });
    const { db: client } = db({});
    mocks.createAdminClient.mockReturnValue(client);

    expect(await respondToFinaleInvite(TOKEN, "yes")).toEqual({ error: "Too many requests." });
  });
});

describe("respondToFinaleInvite: account link (00069)", () => {
  it("links the created application to the invitee's account", async () => {
    const { db: client, calls } = db({});
    mocks.createAdminClient.mockReturnValue(client);

    await respondToFinaleInvite(TOKEN, "yes");

    expect(inserted(calls)).toMatchObject({ user_id: "u1", email: "ada@example.com" });
  });
});
