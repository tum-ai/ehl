import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The chapter-wide code-review status overview powers the admin page poller. It
// is chapter-scoped (local admins can view their own chapter) and returns both
// per-submission status rows and an aggregated summary. These tests pin the
// guard and the summary shape.

const mocks = vi.hoisted(() => ({
  requireChapterAdminApi: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireChapterAdminApi: mocks.requireChapterAdminApi }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/api/admin/chapters/[id]/code-reviews/route";

const CHAPTER = "chapter-x";
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Builds an admin client whose table queries resolve to the given fixtures.
 * challenges -> [{id}], submissions (head/count) -> count, submissions (list) ->
 * rows, code_reviews -> review rows.
 */
function fakeAdminClient(opts: {
  challengeIds: string[];
  submissionIds: string[]; // the DISPLAYED (limited) subset
  reviews: Array<{ submission_id: string; status: string; progress: string | null; cost_usd: number | null }>;
  // Optional: the FULL chapter when it exceeds the display limit. submissionCount
  // is the real total; allReviews is every review used for the summary.
  submissionCount?: number;
  allSubmissionIds?: string[];
  allReviews?: Array<{ submission_id: string; status: string; progress: string | null; cost_usd: number | null }>;
  // The app_settings row returned for the last-dispatch lookup ({ value: "<json>" }).
  lastDispatchValue?: { value: string } | null;
}) {
  const count = opts.submissionCount ?? opts.submissionIds.length;
  let reviewSelects = 0;
  return {
    from(table: string) {
      if (table === "app_settings") {
        // getCodeReviewLastDispatch: .select("value").eq("key",...).single().
        // Default: no dispatch recorded yet (null).
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.lastDispatchValue ?? null,
                }),
            }),
          }),
        };
      }
      if (table === "challenges") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.challengeIds.map((id) => ({ id })) }),
          }),
        };
      }
      if (table === "submissions") {
        return {
          select: (_cols: string, options?: { head?: boolean }) => {
            if (options?.head) {
              return { in: () => Promise.resolve({ count }) };
            }
            // .in() is awaitable directly (full-list query, no limit) AND
            // chainable with .limit() (displayed subset).
            const fullIds = (opts.allSubmissionIds ?? opts.submissionIds).map((id) => ({ id }));
            const limitedIds = opts.submissionIds.map((id) => ({ id }));
            return {
              in: () => {
                const p = Promise.resolve({ data: fullIds });
                return Object.assign(p, {
                  limit: () => Promise.resolve({ data: limitedIds }),
                });
              },
            };
          },
        };
      }
      // code_reviews: first select = displayed subset, second = full (summary).
      return {
        select: () => ({
          in: () => {
            reviewSelects += 1;
            const data = reviewSelects === 1 ? opts.reviews : opts.allReviews ?? opts.reviews;
            return Promise.resolve({ data });
          },
        }),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/chapters/[id]/code-reviews", () => {
  it("short-circuits with the guard response when access is denied", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    mocks.requireChapterAdminApi.mockResolvedValue(denied);

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));

    expect(res.status).toBe(403);
    expect(mocks.requireChapterAdminApi).toHaveBeenCalledWith(CHAPTER);
    // No data is computed once denied.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns per-submission rows and an aggregated summary", async () => {
    mocks.requireChapterAdminApi.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(
      fakeAdminClient({
        challengeIds: ["c1"],
        submissionIds: ["s1", "s2", "s3", "s4"],
        reviews: [
          { submission_id: "s1", status: "completed", progress: null, cost_usd: 0.5 },
          { submission_id: "s2", status: "processing", progress: "Running coordinator...", cost_usd: null },
          { submission_id: "s3", status: "failed", progress: "Repository is empty.", cost_usd: null },
        ],
      })
    );

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalSubmissions).toBe(4);
    expect(json.reviews).toHaveLength(3);
    // s4 has no review row -> pending.
    expect(json.summary.pending).toBe(1);
    expect(json.summary.completed).toBe(1);
    expect(json.summary.processing).toBe(1);
    expect(json.summary.failed).toBe(1);
    expect(json.summary.inFlight).toBe(true);
    expect(json.summary.totalCostUsd).toBeCloseTo(0.5, 6);
  });

  it("returns an empty summary for a chapter with no challenges", async () => {
    mocks.requireChapterAdminApi.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(
      fakeAdminClient({ challengeIds: [], submissionIds: [], reviews: [] })
    );

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalSubmissions).toBe(0);
    expect(json.reviews).toEqual([]);
    expect(json.summary.inFlight).toBe(false);
    expect(json.truncated).toBe(false);
  });

  it("summary counts in-flight reviews BEYOND the display limit (no false 'done')", async () => {
    // The chapter has more submissions than the display limit. The displayed
    // subset is all completed, but a queued review exists outside the subset.
    // The summary must still report inFlight=true so polling doesn't stop and
    // Queue All doesn't requeue the running one.
    mocks.requireChapterAdminApi.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(
      fakeAdminClient({
        challengeIds: ["c1"],
        submissionIds: ["s1"], // displayed subset (limit=1 here)
        reviews: [{ submission_id: "s1", status: "completed", progress: null, cost_usd: 0.1 }],
        submissionCount: 3, // real total exceeds the displayed subset -> full path
        allSubmissionIds: ["s1", "s2", "s3"],
        allReviews: [
          { submission_id: "s1", status: "completed", progress: null, cost_usd: 0.1 },
          { submission_id: "s2", status: "queued", progress: null, cost_usd: null },
          { submission_id: "s3", status: "processing", progress: "step 2", cost_usd: null },
        ],
      })
    );

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Displayed list is still the limited subset (1 row).
    expect(json.reviews).toHaveLength(1);
    // Summary reflects ALL reviews in the chapter, including the queued and
    // processing ones BEYOND the displayed subset — this is the fix: building
    // the summary only from the displayed rows would report inFlight=false.
    expect(json.summary.queued).toBe(1);
    expect(json.summary.processing).toBe(1);
    expect(json.summary.completed).toBe(1);
    expect(json.summary.inFlight).toBe(true);
  });

  it("surfaces a failed last dispatch as workerHealth.dispatch_failed", async () => {
    mocks.requireChapterAdminApi.mockResolvedValue(null);
    mocks.createAdminClient.mockReturnValue(
      fakeAdminClient({
        challengeIds: ["c1"],
        submissionIds: ["s1"],
        reviews: [{ submission_id: "s1", status: "queued", progress: null, cost_usd: null }],
        lastDispatchValue: {
          value: JSON.stringify({
            ok: false,
            attempted: true,
            message: "GitHub dispatch failed (HTTP 404)",
            at: "2026-06-27T00:00:00Z",
          }),
        },
      })
    );

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.workerHealth.state).toBe("dispatch_failed");
    expect(json.lastDispatch.ok).toBe(false);
    expect(json.lastDispatch.message).toMatch(/404/);
  });
});
