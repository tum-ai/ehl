import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the silent-config-reset bug.
//
// `updateChallenge` is reused by two callers that send DIFFERENT subsets of the
// challenge config:
//   1. the full challenge create/edit form (sends every field)
//   2. the Code Reviews page, which saves ONLY code_review_config
//
// The original implementation always wrote every column, parsing absent boolean
// keys as `false` and absent JSON keys as `null`. So saving the code-review
// config from page (2) silently flipped entire_required / invite_jury_to_forks
// OFF and wiped submission_fields, even though the admin never touched them.
//
// The contract now: updateChallenge is a PARTIAL update. A column is written
// ONLY when its form key is present. An absent key leaves the stored value
// untouched. A boolean is turned off ONLY when the caller explicitly sends
// "off". These tests pin that contract.

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateChallenge } from "@/lib/actions/admin";

// Admin client that records the exact payload passed to .update().
function makeAdminClient(captured: { update?: Record<string, unknown>; eqId?: string }) {
  return {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        captured.update = payload;
        return {
          eq: (_col: string, id: string) => {
            captured.eqId = id;
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
  });
});

describe("updateChallenge (partial update)", () => {
  it("rejects a non-admin caller before touching the DB", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("title", "X");
    const res = await updateChallenge(fd);
    expect(res).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("requires challengeId and title", async () => {
    const res = await updateChallenge(new FormData());
    expect(res).toEqual({ error: "Challenge ID and title are required." });
  });

  it("THE BUG: a code-review-only save does not touch entire/fork/scoring/fields", async () => {
    const captured: { update?: Record<string, unknown>; eqId?: string } = {};
    mocks.createAdminClient.mockReturnValue(makeAdminClient(captured));

    // Exactly what the Code Reviews page sends: id + title + codeReviewConfig.
    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("chapterId", "chap1");
    fd.set("title", "AI Challenge");
    fd.set("codeReviewConfig", JSON.stringify({ models: { coordinator: "x" } }));

    const res = await updateChallenge(fd);
    expect(res).toEqual({ success: true });
    expect(captured.eqId).toBe("c1");

    const u = captured.update!;
    // Only title + code_review_config are written.
    expect(u.title).toBe("AI Challenge");
    expect(u.code_review_config).toEqual({ models: { coordinator: "x" } });

    // These columns MUST NOT be present, so their stored values are preserved.
    expect("entire_required" in u).toBe(false);
    expect("invite_jury_to_forks" in u).toBe(false);
    expect("is_scored" in u).toBe(false);
    expect("code_review_enabled" in u).toBe(false);
    expect("submission_fields" in u).toBe(false);
    expect("description" in u).toBe(false);
  });

  it("writes booleans only when present; 'on' -> true, 'off' -> false", async () => {
    const captured: { update?: Record<string, unknown> } = {};
    mocks.createAdminClient.mockReturnValue(makeAdminClient(captured));

    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("title", "T");
    fd.set("entireRequired", "on");
    fd.set("inviteJuryToForks", "off");
    // isScored / codeReviewEnabled intentionally omitted.

    await updateChallenge(fd);
    const u = captured.update!;
    expect(u.entire_required).toBe(true);
    expect(u.invite_jury_to_forks).toBe(false);
    expect("is_scored" in u).toBe(false);
    expect("code_review_enabled" in u).toBe(false);
  });

  it("full form payload writes every field (off toggles persist as false)", async () => {
    const captured: { update?: Record<string, unknown> } = {};
    mocks.createAdminClient.mockReturnValue(makeAdminClient(captured));

    // Mirrors the full challenge edit form, which always sends explicit on/off.
    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("chapterId", "chap1");
    fd.set("title", "Full");
    fd.set("description", "desc");
    fd.set("sponsorName", "Acme");
    fd.set("codeReviewEnabled", "on");
    fd.set("isScored", "off");
    fd.set("inviteJuryToForks", "on");
    fd.set("entireRequired", "off");
    fd.set("codeReviewInstructions", "");
    fd.set("submissionFields", JSON.stringify([{ key: "repo", label: "Repo" }]));

    await updateChallenge(fd);
    const u = captured.update!;
    expect(u.title).toBe("Full");
    expect(u.description).toBe("desc");
    expect(u.sponsor_name).toBe("Acme");
    expect(u.code_review_enabled).toBe(true);
    expect(u.is_scored).toBe(false);
    expect(u.invite_jury_to_forks).toBe(true);
    expect(u.entire_required).toBe(false);
    // empty instructions normalize to null, not "".
    expect(u.code_review_instructions).toBeNull();
    expect(u.submission_fields).toEqual([{ key: "repo", label: "Repo" }]);
  });

  it("rejects invalid submissionFields JSON without writing anything", async () => {
    const captured: { update?: Record<string, unknown> } = {};
    mocks.createAdminClient.mockReturnValue(makeAdminClient(captured));

    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("title", "T");
    fd.set("submissionFields", "{not json");

    const res = await updateChallenge(fd);
    expect(res).toEqual({ error: "Invalid submission fields JSON." });
    expect(captured.update).toBeUndefined();
  });

  it("an empty-string text field normalizes to null (present means write)", async () => {
    const captured: { update?: Record<string, unknown> } = {};
    mocks.createAdminClient.mockReturnValue(makeAdminClient(captured));

    const fd = new FormData();
    fd.set("challengeId", "c1");
    fd.set("title", "T");
    fd.set("sponsorName", "");

    await updateChallenge(fd);
    const u = captured.update!;
    expect("sponsor_name" in u).toBe(true);
    expect(u.sponsor_name).toBeNull();
  });
});
