import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESSION: a partial form submission must NEVER silently clear challenge
// flags it does not manage. The original bug: the code-review "Configure" panel
// called the full updateChallenge() with a payload that omitted is_scored /
// entire_required / invite_jury_to_forks / submission_fields, and because each
// boolean was derived from `formData.get(name) === "on"` (false when absent), a
// challenge created as Scored silently flipped to unscored after saving an
// unrelated panel. We assert:
//   1. updateChallenge only writes fields it is told it manages (managedFields).
//   2. Without a manifest, it only writes fields actually present (never clears
//      an absent field).
//   3. Explicit booleans ("true"/"false") are honoured, including writing false.
//   4. updateCodeReviewConfig writes ONLY code_review_config (+ optional enabled)
//      and never touches is_scored or any other flag.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: mocks.logEventStrict,
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/emails/render", () => ({ renderCertificateEmail: vi.fn() }));

import { updateChallenge, updateCodeReviewConfig } from "@/lib/actions/admin";

const CHALLENGE = "challenge-1";
const CHAPTER = "chapter-1";

interface CallState {
  table: string;
  op: string;
  filters: [string, unknown][];
  payload: unknown;
}

function makeAdminClient(opts: {
  responder: (s: CallState) => unknown;
  calls: CallState[];
}) {
  function makeBuilder() {
    const state: CallState = { table: "", op: "select", filters: [], payload: null };
    const resolve = () => {
      opts.calls.push({ ...state, filters: [...state.filters] });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      order: () => builder,
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

function responder({ table, op }: CallState) {
  if (table === "challenges" && op === "select")
    return { data: { chapter_id: CHAPTER } };
  if (table === "challenges" && op === "update") return { error: null };
  return { data: null, error: null };
}

function updatePayload(calls: CallState[]): Record<string, unknown> {
  const update = calls.find((c) => c.table === "challenges" && c.op === "update");
  return (update?.payload as Record<string, unknown>) ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
});

describe("updateChallenge — partial update safety", () => {
  it("writes ONLY managed fields and leaves is_scored untouched when not managed", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("title", "New Title");
    fd.set("codeReviewConfig", JSON.stringify({ models: [] }));
    // This caller manages only title + config. It does NOT manage is_scored.
    fd.set("managedFields", "title,codeReviewConfig");
    // Even if a stale is_scored=false leaked into the payload, the manifest must
    // win and it must NOT be written.
    fd.set("isScored", "false");

    const result = await updateChallenge(fd);
    expect(result).toEqual({ success: true });

    const payload = updatePayload(calls);
    expect(payload).toHaveProperty("title", "New Title");
    expect(payload).toHaveProperty("code_review_config");
    // The critical assertion: is_scored is NOT in the patch at all.
    expect(payload).not.toHaveProperty("is_scored");
    expect(payload).not.toHaveProperty("entire_required");
    expect(payload).not.toHaveProperty("invite_jury_to_forks");
    expect(payload).not.toHaveProperty("submission_fields");
  });

  it("writes every managed field including explicit false booleans", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("title", "T");
    fd.set("isScored", "true");
    fd.set("entireRequired", "false");
    fd.set("codeReviewEnabled", "false");
    fd.set("inviteJuryToForks", "true");
    fd.set("submissionFields", JSON.stringify([{ key: "repo" }]));
    fd.set(
      "managedFields",
      "title,isScored,entireRequired,codeReviewEnabled,inviteJuryToForks,submissionFields"
    );

    await updateChallenge(fd);
    const payload = updatePayload(calls);
    expect(payload.is_scored).toBe(true);
    expect(payload.entire_required).toBe(false);
    expect(payload.code_review_enabled).toBe(false);
    expect(payload.invite_jury_to_forks).toBe(true);
    expect(payload.submission_fields).toEqual([{ key: "repo" }]);
  });

  it("without a manifest, only writes fields actually present (never clears absent fields)", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("codeReviewConfig", JSON.stringify({ models: [] }));
    // No managedFields, no isScored present -> must not clear it.

    await updateChallenge(fd);
    const payload = updatePayload(calls);
    expect(payload).toHaveProperty("code_review_config");
    expect(payload).not.toHaveProperty("is_scored");
  });

  it("writes maxTeams as a number when managed", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("maxTeams", "10");
    fd.set("managedFields", "maxTeams");

    const result = await updateChallenge(fd);
    expect(result).toEqual({ success: true });
    const payload = updatePayload(calls);
    expect(payload.max_teams).toBe(10);
  });

  it("clears maxTeams to null when managed and sent empty (unlimited)", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("maxTeams", "");
    fd.set("managedFields", "maxTeams");

    const result = await updateChallenge(fd);
    expect(result).toEqual({ success: true });
    const payload = updatePayload(calls);
    expect(payload.max_teams).toBeNull();
  });

  it("rejects a non-positive maxTeams before writing", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const fd = new FormData();
    fd.set("challengeId", CHALLENGE);
    fd.set("chapterId", CHAPTER);
    fd.set("maxTeams", "0");
    fd.set("managedFields", "maxTeams");

    const result = await updateChallenge(fd);
    expect(result.error).toMatch(/positive whole number/i);
  });

  it("rejects when challengeId is missing", async () => {
    const fd = new FormData();
    fd.set("title", "T");
    const result = await updateChallenge(fd);
    expect(result.error).toMatch(/challenge id/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("updateCodeReviewConfig — narrow, non-destructive", () => {
  it("writes ONLY code_review_config and never any challenge flag", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    const result = await updateCodeReviewConfig(CHALLENGE, { models: ["m"] });
    expect(result).toEqual({ success: true });

    const payload = updatePayload(calls);
    expect(payload).toEqual({ code_review_config: { models: ["m"] } });
    // Belt and suspenders: none of the dangerous flags appear.
    expect(payload).not.toHaveProperty("is_scored");
    expect(payload).not.toHaveProperty("entire_required");
    expect(payload).not.toHaveProperty("code_review_enabled");
  });

  it("writes code_review_enabled only when explicitly passed", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls, responder }));

    await updateCodeReviewConfig(CHALLENGE, { models: [] }, { enabled: true });
    const payload = updatePayload(calls);
    expect(payload.code_review_enabled).toBe(true);
    expect(payload).not.toHaveProperty("is_scored");
  });

  it("rejects a non-admin caller before any DB write", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await updateCodeReviewConfig(CHALLENGE, {});
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
