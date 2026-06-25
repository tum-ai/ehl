import { describe, it, expect, vi, beforeEach } from "vitest";

// The Paris dry-run "Publish Results doesn't work" bug was a UI-only block: the
// button was disabled when scores.length === 0, so a chapter with no finalized
// scores could never be completed. The publishScores ACTION itself has no such
// gate. These tests pin that: the action is global-admin-only, and it succeeds
// (marks the chapter completed) even with zero score rows.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.requireAdminAction }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEventStrict: mocks.logEventStrict,
  logEvent: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { publishScores } from "@/lib/actions/admin";

const CHAPTER = "chapter-1";

// Mock admin client: records each table.update() and returns the configured error
// (default none). Mirrors the real `.from(t).update(p).eq(k,v)` chain.
function makeAdminClient(opts: {
  updateError?: { table: string; message: string };
  calls: Array<{ table: string; payload: unknown }>;
}) {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        update: (payload: unknown) => {
          opts.calls.push({ table, payload });
          return builder;
        },
        eq: () =>
          Promise.resolve({
            error:
              opts.updateError && opts.updateError.table === table
                ? { message: opts.updateError.message }
                : null,
          }),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
  });
});

describe("publishScores", () => {
  it("rejects a non-global-admin caller", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("succeeds and completes the chapter even with ZERO scores (Paris bug)", async () => {
    const calls: Array<{ table: string; payload: unknown }> = [];
    // No updateError -> the scores update matches 0 rows but does not error,
    // exactly as Postgres behaves for an empty match set.
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls }));

    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ success: true });

    // It published scores (no-op on 0 rows) AND set the chapter to completed.
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "scores", payload: expect.objectContaining({ published: true }) })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "chapters", payload: { status: "completed" } })
    );
  });

  it("surfaces an error if the chapter status update fails", async () => {
    const calls: Array<{ table: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ updateError: { table: "chapters", message: "boom" }, calls })
    );
    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ error: "boom" });
  });

  it("marks scores published in the exact shape the public read filter requires", async () => {
    // The public leaderboard VIEW and getPublishedScoresForTeam both select only
    // rows where `published` is true. publishScores must therefore flip published
    // to TRUE (not just touch published_at). This is what makes materialized
    // scores actually surface publicly after the Symptom B fix finalizes them.
    const calls: Array<{ table: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ calls }));

    const res = await publishScores(CHAPTER);
    expect(res).toEqual({ success: true });

    const scoreUpdate = calls.find((c) => c.table === "scores");
    expect(scoreUpdate).toBeDefined();
    const payload = scoreUpdate!.payload as { published: unknown; published_at: unknown };
    // Strictly true so the `.eq("published", true)` / `FILTER (WHERE s.published)`
    // public reads include the row.
    expect(payload.published).toBe(true);
    // And a publish timestamp is recorded.
    expect(typeof payload.published_at).toBe("string");

    // Simulate the public read filter against a now-published row: it must pass.
    const publishedRow = { published: payload.published };
    const passesPublicFilter = publishedRow.published === true;
    expect(passesPublicFilter).toBe(true);
  });
});
