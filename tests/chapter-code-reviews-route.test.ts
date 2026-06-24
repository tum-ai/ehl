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
  submissionIds: string[];
  reviews: Array<{ submission_id: string; status: string; progress: string | null; cost_usd: number | null }>;
}) {
  return {
    from(table: string) {
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
              // count probe
              return { in: () => Promise.resolve({ count: opts.submissionIds.length }) };
            }
            return {
              in: () => ({
                limit: () =>
                  Promise.resolve({ data: opts.submissionIds.map((id) => ({ id })) }),
              }),
            };
          },
        };
      }
      // code_reviews
      return {
        select: () => ({ in: () => Promise.resolve({ data: opts.reviews }) }),
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
});
