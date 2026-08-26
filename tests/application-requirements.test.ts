import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-chapter application requirements (migration 00064).
//
// Which fields the public apply form makes mandatory used to be hardcoded in
// getMissingFields() on the CLIENT, which means a non-browser caller skipped it
// entirely. chapters.require_cv / require_motivation move that decision into the
// DB, and submitApplication re-checks BOTH against the chapter row. We pin:
//   - require_cv: a submission with no CV is refused and inserts NOTHING
//   - require_cv: a valid PDF is accepted
//   - require_motivation: blank / whitespace-only is refused, inserts NOTHING
//   - require_motivation: an answer is accepted and persisted to form_data
//   - both flags off: the historical behavior (neither CV nor motivation needed)
//     still works — the regression guard for every chapter that is NOT Zurich
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  checkRateLimit: vi.fn(),
  uploadFile: vi.fn(),
  logEvent: vi.fn(),
  sendEmailAfterResponse: vi.fn(),
  getCurrentMembership: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email-deferred", () => ({
  sendEmailAfterResponse: mocks.sendEmailAfterResponse,
}));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationReceivedEmail: vi.fn().mockResolvedValue("<html></html>"),
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  renderApplicationCancelledEmail: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: vi.fn() }));
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
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: () => ({ get: () => "1.2.3.4" }) }));

import { submitApplication } from "@/lib/actions/applications";

const CHAPTER_ID = "chapter-zurich";

type Call = { table: string; op: string; payload: unknown };

// Chainable Supabase mock, same shape as tests/walk-in.test.ts: a responder
// decides each terminal call's result, every write is recorded in `calls`.
function makeAdminClient(opts: {
  responder: (s: { table: string; op: string }) => unknown;
  calls: Call[];
}) {
  function makeBuilder() {
    const state = { table: "", op: "select", payload: null as unknown };
    const resolve = () => {
      opts.calls.push({ table: state.table, op: state.op, payload: state.payload });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      eq: () => builder,
      maybeSingle: () => resolve(),
      single: () => resolve(),
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

function responderFor(flags: { require_cv: boolean; require_motivation: boolean }) {
  return ({ table, op }: { table: string; op: string }) => {
    if (table === "chapters" && op === "select")
      return {
        data: {
          id: CHAPTER_ID,
          name: "Zurich",
          city: "Zurich",
          country: "Switzerland",
          date: "2026-09-01",
          date_end: null,
          slug: "zurich-1",
          status: "applications_open",
          ...flags,
        },
      };
    if (table === "applications" && op === "select") return { data: null }; // no duplicate
    if (table === "profiles" && op === "select") return { data: null };
    if (table === "applications" && op === "insert")
      return { data: { id: "app-1" }, error: null };
    return { data: null, error: null };
  };
}

function baseForm(extra: Record<string, string | File> = {}): FormData {
  const fd = new FormData();
  fd.set("chapterId", CHAPTER_ID);
  fd.set("firstName", "Ada");
  fd.set("lastName", "Lovelace");
  fd.set("email", "ada@example.com");
  fd.set("cf-turnstile-response", "tok");
  fd.set("discoverySource", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function pdf(name = "cv.pdf"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

function inserts(calls: Call[]) {
  return calls.filter((c) => c.table === "applications" && c.op === "insert");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileToken.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.getCurrentMembership.mockResolvedValue(null);
  mocks.uploadFile.mockResolvedValue({ fileId: "drive-file-1" });
});

describe("chapter.require_cv", () => {
  it("refuses a submission with no CV and inserts nothing", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: true, require_motivation: false }),
      })
    );

    const result = await submitApplication(baseForm());

    expect(result).toEqual({ error: "A CV (PDF) is required for this match." });
    expect(inserts(calls)).toHaveLength(0);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("accepts a submission with a PDF CV and attaches the Drive file", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: true, require_motivation: false }),
      })
    );

    const result = await submitApplication(baseForm({ cv: pdf() }));

    expect(result).toEqual({ success: true, cvUploadFailed: false });
    expect(inserts(calls)).toHaveLength(1);
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    const update = calls.find((c) => c.table === "applications" && c.op === "update");
    expect(update?.payload).toEqual({ cv_url: "drive-file-1" });
  });

  it("still rejects a non-PDF even though a file was attached", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: true, require_motivation: false }),
      })
    );

    const result = await submitApplication(
      baseForm({ cv: new File([new Uint8Array([1])], "cv.docx", { type: "application/msword" }) })
    );

    expect(result).toEqual({ error: "CV must be a PDF file." });
    expect(inserts(calls)).toHaveLength(0);
  });
});

describe("chapter.require_motivation", () => {
  it("refuses a blank motivation and inserts nothing", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: false, require_motivation: true }),
      })
    );

    const result = await submitApplication(baseForm());

    expect(result).toEqual({ error: "Please answer the motivation question." });
    expect(inserts(calls)).toHaveLength(0);
  });

  it("refuses a whitespace-only motivation", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: false, require_motivation: true }),
      })
    );

    const result = await submitApplication(baseForm({ motivation: "   \n  " }));

    expect(result).toEqual({ error: "Please answer the motivation question." });
    expect(inserts(calls)).toHaveLength(0);
  });

  it("accepts an answer and persists it to form_data", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: false, require_motivation: true }),
      })
    );

    const result = await submitApplication(
      baseForm({ motivation: "I want to ship something real with a team." })
    );

    expect(result).toEqual({ success: true, cvUploadFailed: false });
    const insert = inserts(calls)[0];
    expect((insert.payload as { form_data: { motivation: string } }).form_data.motivation).toBe(
      "I want to ship something real with a team."
    );
  });
});

describe("both flags off (every chapter that has not opted in)", () => {
  it("submits with neither a CV nor a motivation answer", async () => {
    const calls: Call[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: responderFor({ require_cv: false, require_motivation: false }),
      })
    );

    const result = await submitApplication(baseForm());

    expect(result).toEqual({ success: true, cvUploadFailed: false });
    expect(inserts(calls)).toHaveLength(1);
    // No motivation asked -> the key is stored null, never undefined.
    expect(
      (inserts(calls)[0].payload as { form_data: { motivation: string | null } }).form_data
        .motivation
    ).toBeNull();
  });
});
