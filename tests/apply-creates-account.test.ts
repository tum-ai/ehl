import { describe, it, expect, vi, beforeEach } from "vitest";

// Apply creates the account (migration 00069).
//
// The public apply form used to insert an application for any typed email, with
// no proof the applicant controlled it and no account behind it. It is now two
// steps: startApplication validates the whole form and emails a code (or, for a
// signed-in applicant, submits at once), and confirmApplication checks the code
// and only then creates the account and the application. We pin:
//   start
//   - a new address must set a matching password of 8+ characters
//   - a new address gets a code: a verification row holding the chapter, the
//     email and the ENCRYPTED password, and NOTHING else is written
//   - an address that already has an account needs no password (row stores none)
//   - every form check (duplicate, CV, motivation, closed chapter, bot check)
//     refuses BEFORE a code is sent
//   - a failed code email deletes the row it just wrote
//   - a signed-in applicant submits at once, as their session's email and id,
//     whatever email the form carries
//   confirm
//   - wrong / expired / exhausted codes write no account and no application
//   - the right code creates the account from the RECORD's email and chapter
//     (the resubmitted form cannot redirect it), links user_id, deletes the code
//     and signs the new account in
//   - an existing account gets the application linked, and is NOT signed in
//   - a fixable form error does not consume the code
//   - failures after the claim hand the code back
//   - the team is derived from the account, never taken from the form
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  checkRateLimit: vi.fn(),
  uploadFile: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  sendEmailAfterResponse: vi.fn(),
  renderVerificationCodeEmail: vi.fn(),
  getCurrentMembership: vi.fn(),
  getSession: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-deferred", () => ({
  sendEmailAfterResponse: mocks.sendEmailAfterResponse,
}));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationReceivedEmail: vi.fn().mockResolvedValue("<html></html>"),
  renderVerificationCodeEmail: mocks.renderVerificationCodeEmail,
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  renderApplicationCancelledEmail: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/queries", () => ({ getChapterCommunications: vi.fn() }));
vi.mock("@/lib/team-membership", () => ({
  getCurrentMembership: mocks.getCurrentMembership,
}));
vi.mock("@/lib/gdrive", () => ({ uploadFile: mocks.uploadFile }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  applicationLimiter: {},
  apiLimiter: {},
}));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/crypto", () => ({
  encryptPassword: (p: string) => `enc(${p})`,
  decryptPassword: (s: string) => s.replace(/^enc\((.*)\)$/, "$1"),
  generateVerificationCode: () => "123456",
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: () => ({ get: () => "1.2.3.4" }) }));

import { startApplication, confirmApplication } from "@/lib/actions/applications";

const CHAPTER_ID = "chapter-paris";
const OTHER_CHAPTER_ID = "chapter-other";
const EMAIL = "ada@example.com";

type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Call = {
  table: string;
  op: Op;
  payload: unknown;
  filters: Record<string, unknown>;
};
type Responder = (c: Call) => unknown;

// Chainable Supabase mock in the style of tests/walk-in.test.ts. Every terminal
// call is recorded with its filters, so a test can tell the code CLAIM
// (verified_at set) from the RELEASE (verified_at back to null).
function makeAdminClient(responder: Responder, calls: Call[]) {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", payload: null, filters: {} };
      const resolve = () => {
        calls.push(call);
        return Promise.resolve(responder(call) ?? { data: null, error: null });
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), builder),
        update: (p: unknown) => ((call.op = "update"), (call.payload = p), builder),
        upsert: (p: unknown) => ((call.op = "upsert"), (call.payload = p), builder),
        delete: () => ((call.op = "delete"), builder),
        eq: (k: string, v: unknown) => ((call.filters[k] = v), builder),
        is: (k: string, v: unknown) => ((call.filters[k] = v), builder),
        maybeSingle: resolve,
        single: resolve,
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          resolve().then(onF, onR),
      };
      return builder;
    },
    auth: { admin: { createUser: mocks.createUser, getUserById: mocks.getUserById } },
  };
}

const openChapter = (id = CHAPTER_ID, extra: Record<string, unknown> = {}) => ({
  id,
  name: id === CHAPTER_ID ? "Paris" : "Other",
  city: "Paris",
  country: "France",
  date: "2026-11-01",
  date_end: null,
  status: "applications_open",
  require_cv: false,
  require_motivation: false,
  ...extra,
});

function verificationRecord(extra: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    email: EMAIL,
    code: "123456",
    type: "application_registration",
    attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    verified_at: null,
    metadata: { chapterId: CHAPTER_ID, email: EMAIL, password: "enc(hunter22)" },
    ...extra,
  };
}

interface World {
  chapters?: Record<string, Record<string, unknown>>;
  profile?: { id: string } | null;
  duplicate?: boolean;
  record?: Record<string, unknown> | null;
  claimWins?: boolean;
  /** A concurrent guess already spent the attempt this request read. */
  attemptRaceLost?: boolean;
  insertError?: { code: string } | null;
  verificationInsertError?: boolean;
}

function responderFor(w: World): Responder {
  const chapters: Record<string, Record<string, unknown>> = w.chapters ?? {
    [CHAPTER_ID]: openChapter(),
  };
  return (c) => {
    if (c.table === "chapters") return { data: chapters[c.filters.id as string] ?? null };
    if (c.table === "profiles" && c.op === "select") return { data: w.profile ?? null };
    if (c.table === "applications" && c.op === "select")
      return { data: w.duplicate ? { id: "dup" } : null };
    if (c.table === "applications" && c.op === "insert")
      return w.insertError
        ? { data: null, error: w.insertError }
        : { data: { id: "app-1" }, error: null };
    if (c.table === "verification_codes") {
      if (c.op === "insert")
        return w.verificationInsertError
          ? { data: null, error: { message: "boom" } }
          : { data: { id: "ver-1" }, error: null };
      if (c.op === "select") return { data: w.record ?? null };
      if (c.op === "update" && (c.payload as { verified_at?: unknown }).verified_at)
        return { data: w.claimWins === false ? null : { id: "ver-1" } };
      if (c.op === "update" && "attempts" in (c.payload as object))
        return { data: w.attemptRaceLost ? null : { id: "ver-1" } };
    }
    return { data: null, error: null };
  };
}

function setup(w: World) {
  const calls: Call[] = [];
  mocks.createAdminClient.mockReturnValue(makeAdminClient(responderFor(w), calls));
  return calls;
}

function form(extra: Record<string, string | File> = {}): FormData {
  const fd = new FormData();
  fd.set("chapterId", CHAPTER_ID);
  fd.set("firstName", "Ada");
  fd.set("lastName", "Lovelace");
  fd.set("email", EMAIL);
  fd.set("cf-turnstile-response", "tok");
  fd.set("discoverySource", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

const newAccountForm = (extra: Record<string, string | File> = {}) =>
  form({ password: "hunter22", passwordConfirm: "hunter22", ...extra });

const confirmForm = (extra: Record<string, string | File> = {}) =>
  form({ verificationId: "ver-1", code: "123456", ...extra });

const pdf = () => new File([new Uint8Array([1, 2, 3])], "cv.pdf", { type: "application/pdf" });

const of = (calls: Call[], table: string, op: Op) =>
  calls.filter((c) => c.table === table && c.op === op);

const claims = (calls: Call[]) =>
  of(calls, "verification_codes", "update").filter(
    (c) => (c.payload as { verified_at?: unknown }).verified_at
  );
const releases = (calls: Call[]) =>
  of(calls, "verification_codes", "update").filter(
    (c) => "verified_at" in (c.payload as object) && (c.payload as { verified_at: unknown }).verified_at === null
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileToken.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.getCurrentMembership.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue(null);
  mocks.uploadFile.mockResolvedValue({ fileId: "drive-file-1" });
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.renderVerificationCodeEmail.mockResolvedValue("<html>code</html>");
  mocks.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  mocks.getUserById.mockResolvedValue({ data: { user: { email: EMAIL } }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue({
    auth: { signInWithPassword: mocks.signInWithPassword },
  });
});

// ─── startApplication ───────────────────────────────────────────

describe("startApplication, signed out, new address", () => {
  it("requires a password of at least 8 characters and sends nothing", async () => {
    const calls = setup({});
    const result = await startApplication(form({ password: "short", passwordConfirm: "short" }));
    expect(result).toEqual({ error: "Password must be at least 8 characters." });
    expect(of(calls, "verification_codes", "insert")).toHaveLength(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    const calls = setup({});
    const result = await startApplication(
      form({ password: "hunter22", passwordConfirm: "hunter23" })
    );
    expect(result).toEqual({ error: "Passwords do not match." });
    expect(of(calls, "verification_codes", "insert")).toHaveLength(0);
  });

  it("stores a code with the chapter and the ENCRYPTED password, emails it, and writes nothing else", async () => {
    const calls = setup({});
    const result = await startApplication(newAccountForm());

    expect(result).toEqual({ verificationId: "ver-1", email: EMAIL });
    const [row] = of(calls, "verification_codes", "insert");
    expect(row.payload).toMatchObject({
      email: EMAIL,
      code: "123456",
      type: "application_registration",
      metadata: { chapterId: CHAPTER_ID, email: EMAIL, password: "enc(hunter22)" },
    });
    expect(JSON.stringify(row.payload)).not.toContain('"hunter22"');
    expect(mocks.renderVerificationCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456", type: "application_registration", chapterName: "Paris" })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL }));
    // No application, no account, no confirmation email before the code.
    expect(of(calls, "applications", "insert")).toHaveLength(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sendEmailAfterResponse).not.toHaveBeenCalled();
  });

  it("lowercases the address it verifies", async () => {
    const calls = setup({});
    await startApplication(newAccountForm({ email: "  Ada@Example.COM " }));
    expect(of(calls, "verification_codes", "insert")[0].payload).toMatchObject({ email: EMAIL });
  });

  it("deletes the row again when the code email cannot be sent", async () => {
    const calls = setup({});
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));
    const result = await startApplication(newAccountForm());
    expect(result).toEqual({
      error: "Failed to send verification email. Please try again in a moment.",
    });
    expect(of(calls, "verification_codes", "delete")).toHaveLength(1);
  });

  it("reports a failed verification insert without sending an email", async () => {
    setup({ verificationInsertError: true });
    const result = await startApplication(newAccountForm());
    expect(result).toEqual({ error: "Failed to start verification. Please try again." });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("startApplication, signed out, address with an account", () => {
  it("needs no password and stores none", async () => {
    const calls = setup({ profile: { id: "existing-user" } });
    const result = await startApplication(form());
    expect(result).toEqual({ verificationId: "ver-1", email: EMAIL });
    expect(of(calls, "verification_codes", "insert")[0].payload).toMatchObject({
      metadata: { chapterId: CHAPTER_ID, email: EMAIL, password: null },
    });
  });
});

describe("startApplication refuses before any code is sent", () => {
  const cases: Array<[string, World, () => FormData, string]> = [
    [
      "a closed chapter",
      { chapters: { [CHAPTER_ID]: openChapter(CHAPTER_ID, { status: "screening" }) } },
      () => newAccountForm(),
      "Applications are not currently open for this match.",
    ],
    [
      "a duplicate application",
      { duplicate: true },
      () => newAccountForm(),
      "You have already applied for this match.",
    ],
    [
      "a missing required CV",
      { chapters: { [CHAPTER_ID]: openChapter(CHAPTER_ID, { require_cv: true }) } },
      () => newAccountForm(),
      "A CV (PDF) is required for this match.",
    ],
    [
      "a non-PDF CV",
      {},
      () => newAccountForm({ cv: new File([new Uint8Array([1])], "cv.docx") }),
      "CV must be a PDF file.",
    ],
    [
      "a missing required motivation",
      { chapters: { [CHAPTER_ID]: openChapter(CHAPTER_ID, { require_motivation: true }) } },
      () => newAccountForm(),
      "Please answer the motivation question.",
    ],
    [
      "a missing name",
      {},
      () => newAccountForm({ lastName: "  " }),
      "First name, last name, and email are required.",
    ],
  ];

  for (const [label, world, makeForm, message] of cases) {
    it(`refuses ${label}`, async () => {
      const calls = setup(world);
      const result = await startApplication(makeForm());
      expect(result).toEqual({ error: message });
      expect(of(calls, "verification_codes", "insert")).toHaveLength(0);
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    });
  }

  it("refuses a failed bot check", async () => {
    const calls = setup({});
    mocks.verifyTurnstileToken.mockResolvedValue(false);
    const result = await startApplication(newAccountForm());
    expect(result).toEqual({ error: "Bot verification failed. Please try again." });
    expect(calls).toHaveLength(0);
  });

  it("refuses when rate limited", async () => {
    const calls = setup({});
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Slow down." });
    const result = await startApplication(newAccountForm());
    expect(result).toEqual({ error: "Slow down." });
    expect(calls).toHaveLength(0);
  });
});

describe("startApplication, signed in", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      user: { id: "session-user", email: EMAIL },
      profile: { id: "session-user", email: EMAIL },
    });
  });

  it("submits at once as the session's account, with no code", async () => {
    const calls = setup({});
    const result = await startApplication(form());
    expect(result).toEqual({ success: true, cvUploadFailed: false, signedIn: true });
    expect(of(calls, "verification_codes", "insert")).toHaveLength(0);
    const payload = of(calls, "applications", "insert")[0].payload;
    expect(payload).toMatchObject({
      chapter_id: CHAPTER_ID,
      email: EMAIL,
      user_id: "session-user",
    });
    // Status is left to the column default (pending): an account is not an acceptance.
    expect(payload).not.toHaveProperty("status");
    expect(mocks.sendEmailAfterResponse).toHaveBeenCalledTimes(1);
  });

  it("ignores a different email in the form", async () => {
    const calls = setup({});
    await startApplication(form({ email: "someone-else@example.com" }));
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      email: EMAIL,
      user_id: "session-user",
    });
  });
});

// ─── confirmApplication ─────────────────────────────────────────

describe("confirmApplication rejects a bad code without writing anything", () => {
  it("counts a wrong code as an attempt", async () => {
    const calls = setup({ record: verificationRecord({ attempts: 1 }) });
    const result = await confirmApplication(confirmForm({ code: "000000" }));
    expect(result).toEqual({ error: "Incorrect code. 3 attempts remaining." });
    const [spend] = of(calls, "verification_codes", "update");
    expect(spend.payload).toEqual({ attempts: 2 });
    // Compare-and-swap: only matches while attempts still holds the value read.
    expect(spend.filters).toMatchObject({ id: "ver-1", attempts: 1, verified_at: null });
    expect(claims(calls)).toHaveLength(0);
    expect(of(calls, "applications", "insert")).toHaveLength(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("stops after five attempts", async () => {
    const calls = setup({ record: verificationRecord({ attempts: 5 }) });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Too many failed attempts. Please submit the form again." });
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("refuses an expired code", async () => {
    const calls = setup({
      record: verificationRecord({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Your code expired. Please submit the form again." });
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("refuses an unknown or already used verification", async () => {
    const calls = setup({ record: null });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({
      error: "This code is no longer valid. Please submit the form again.",
    });
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("only looks up application_registration codes", async () => {
    const calls = setup({ record: null });
    await confirmApplication(confirmForm());
    expect(of(calls, "verification_codes", "select")[0].filters).toMatchObject({
      id: "ver-1",
      type: "application_registration",
      verified_at: null,
    });
  });
});

describe("confirmApplication with the right code, new address", () => {
  it("creates the account from the record, links the application, deletes the code, signs in", async () => {
    const calls = setup({ record: verificationRecord() });
    const result = await confirmApplication(confirmForm({ cv: pdf() }));

    expect(result).toEqual({ success: true, cvUploadFailed: false, signedIn: true });
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: EMAIL,
      password: "hunter22",
      email_confirm: true,
      user_metadata: { name: "Ada Lovelace" },
    });
    expect(of(calls, "profiles", "upsert")[0].payload).toMatchObject({
      id: "new-user",
      email: EMAIL,
      role: "participant",
    });
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      chapter_id: CHAPTER_ID,
      email: EMAIL,
      user_id: "new-user",
      first_name: "Ada",
      last_name: "Lovelace",
    });
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    expect(of(calls, "verification_codes", "delete")[0].filters).toEqual({ id: "ver-1" });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: "hunter22" });
    expect(mocks.sendEmailAfterResponse).toHaveBeenCalledTimes(1);
    expect(releases(calls)).toHaveLength(0);
  });

  it("uses the record's email and chapter, never the resubmitted form's", async () => {
    const calls = setup({
      record: verificationRecord(),
      chapters: { [CHAPTER_ID]: openChapter(), [OTHER_CHAPTER_ID]: openChapter(OTHER_CHAPTER_ID) },
    });
    await confirmApplication(
      confirmForm({ email: "victim@example.com", chapterId: OTHER_CHAPTER_ID })
    );
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: EMAIL }));
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      chapter_id: CHAPTER_ID,
      email: EMAIL,
    });
  });

  it("derives the team from the account, ignoring an existingTeamId in the form", async () => {
    const calls = setup({ record: verificationRecord() });
    await confirmApplication(confirmForm({ existingTeamId: "someone-elses-team" }));
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      existing_team_id: null,
    });
    expect(mocks.getCurrentMembership).toHaveBeenCalledWith(expect.anything(), "new-user");
  });

  it("reports the CV failure but keeps the application", async () => {
    const calls = setup({ record: verificationRecord() });
    mocks.uploadFile.mockRejectedValue(new Error("drive down"));
    const result = await confirmApplication(confirmForm({ cv: pdf() }));
    expect(result).toEqual({ success: true, cvUploadFailed: true, signedIn: true });
    expect(of(calls, "applications", "insert")).toHaveLength(1);
  });
});

describe("confirmApplication with the right code, address with an account", () => {
  it("links the application to that account without creating one or signing in", async () => {
    mocks.getCurrentMembership.mockResolvedValue({ teamId: "team-7" });
    const calls = setup({
      record: verificationRecord({
        metadata: { chapterId: CHAPTER_ID, email: EMAIL, password: null },
      }),
      profile: { id: "existing-user" },
    });
    const result = await confirmApplication(confirmForm());

    expect(result).toEqual({ success: true, cvUploadFailed: false, signedIn: false });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      user_id: "existing-user",
      existing_team_id: "team-7",
    });
  });

  it("links to an account created in another tab since the code was sent", async () => {
    // The code was started for a NEW address (password stored), but the profile
    // exists by now: reuse it instead of failing on a duplicate createUser.
    const calls = setup({ record: verificationRecord(), profile: { id: "registered-meanwhile" } });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ success: true, cvUploadFailed: false, signedIn: false });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      user_id: "registered-meanwhile",
    });
  });
});

describe("confirmApplication keeps the code usable when it cannot finish", () => {
  it("does not consume the code on a fixable form error", async () => {
    const calls = setup({
      record: verificationRecord(),
      chapters: { [CHAPTER_ID]: openChapter(CHAPTER_ID, { require_motivation: true }) },
    });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Please answer the motivation question." });
    expect(of(calls, "verification_codes", "update")).toHaveLength(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses when applications closed in the meantime, without claiming", async () => {
    const calls = setup({
      record: verificationRecord(),
      chapters: { [CHAPTER_ID]: openChapter(CHAPTER_ID, { status: "screening" }) },
    });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Applications are not currently open for this match." });
    expect(claims(calls)).toHaveLength(0);
  });

  it("does nothing when a concurrent confirm already claimed the code", async () => {
    const calls = setup({ record: verificationRecord(), claimWins: false });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({
      error: "This code was already used. Please log in to see your application.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("hands the code back when the account cannot be created", async () => {
    const calls = setup({ record: verificationRecord() });
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { message: "nope" } });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "We could not create your account. Please try again." });
    expect(releases(calls)).toHaveLength(1);
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("hands the code back when the insert hits the duplicate constraint", async () => {
    const calls = setup({ record: verificationRecord(), insertError: { code: "23505" } });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "You have already applied to this match with this email." });
    expect(releases(calls)).toHaveLength(1);
    expect(of(calls, "verification_codes", "delete")).toHaveLength(0);
  });

  it("asks for the code first", async () => {
    const calls = setup({ record: verificationRecord() });
    const result = await confirmApplication(confirmForm({ code: "" }));
    expect(result).toEqual({ error: "Please enter the code from your email." });
    expect(calls).toHaveLength(0);
  });
});

// ─── Review follow-ups ──────────────────────────────────────────

describe("confirmApplication spends each attempt atomically", () => {
  it("refuses a guess whose attempt a concurrent guess already spent, without comparing", async () => {
    // The right code, but a parallel request got the attempt first: this one
    // must neither claim nor create anything, or a burst of parallel guesses
    // would all be compared against a single recorded attempt.
    const calls = setup({ record: verificationRecord({ attempts: 2 }), attemptRaceLost: true });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Please try again." });
    expect(claims(calls)).toHaveLength(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(of(calls, "applications", "insert")).toHaveLength(0);
  });

  it("spends the attempt before the right code is accepted too", async () => {
    const calls = setup({ record: verificationRecord() });
    await confirmApplication(confirmForm());
    const updates = of(calls, "verification_codes", "update");
    expect(updates[0].payload).toEqual({ attempts: 1 });
    expect((updates[1].payload as { verified_at: unknown }).verified_at).toBeTruthy();
  });
});

describe("malformed answers are refused before anything is written", () => {
  it("startApplication refuses an unreadable field before sending a code", async () => {
    const calls = setup({});
    const result = await startApplication(newAccountForm({ discoverySource: "{not json" }));
    expect(result).toEqual({
      error: "Some answers could not be read. Please reload the page and try again.",
    });
    expect(of(calls, "verification_codes", "insert")).toHaveLength(0);
  });

  it("confirmApplication refuses it without spending an attempt or claiming", async () => {
    const calls = setup({ record: verificationRecord() });
    const result = await confirmApplication(confirmForm({ discoverySource: "{not json" }));
    expect(result).toEqual({
      error: "Some answers could not be read. Please reload the page and try again.",
    });
    expect(of(calls, "verification_codes", "update")).toHaveLength(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe("confirmApplication hands the code back when something throws", () => {
  it("releases the claim when saving the application throws", async () => {
    mocks.getCurrentMembership.mockRejectedValue(new Error("db hiccup"));
    const calls = setup({ record: verificationRecord() });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({ error: "Failed to submit application. Please try again." });
    expect(releases(calls)).toHaveLength(1);
    expect(of(calls, "verification_codes", "delete")).toHaveLength(0);
  });
});

describe("the account identity comes from the auth record", () => {
  it("does not attach to a profile whose auth email is a different address", async () => {
    // A profile row claiming the verified address, while its login identity is
    // someone else's: the application must not be linked to that account.
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: "attacker@example.com" } },
      error: null,
    });
    const calls = setup({ record: verificationRecord(), profile: { id: "attacker-user" } });
    const result = await confirmApplication(confirmForm());
    expect(result).toEqual({
      error: "We could not match this email to an account. Please contact us.",
    });
    expect(of(calls, "applications", "insert")).toHaveLength(0);
    expect(releases(calls)).toHaveLength(1);
  });

  it("a signed-in applicant applies as their auth email, not their profile's", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "session-user", email: EMAIL },
      profile: { id: "session-user", email: "someone-else@example.com" },
    });
    const calls = setup({});
    await startApplication(form());
    expect(of(calls, "applications", "insert")[0].payload).toMatchObject({
      email: EMAIL,
      user_id: "session-user",
    });
  });
});
