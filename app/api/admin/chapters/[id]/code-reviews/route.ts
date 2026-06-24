import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { summarizeReviewStatuses } from "@/lib/code-review/status-summary";
import type { CodeReviewStatus } from "@/lib/types";

/**
 * Lightweight chapter-wide code-review status overview for the admin page.
 *
 * Replaces the old N+1 polling (one /api/admin/code-reviews/[submissionId] fetch
 * per submission) with a single query, so the auto-refresh stays cheap even with
 * ~100 submissions. Returns per-submission status + progress + cost + error, plus
 * an aggregated summary (counts by status). Chapter-scoped so local admins can use
 * it on their own chapter.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chapterId } = await params;
  const denied = await requireChapterAdminApi(chapterId);
  if (denied) return denied;

  const adminClient = createAdminClient();

  // Submissions for this chapter's challenges.
  const { data: challenges } = await adminClient
    .from("challenges")
    .select("id")
    .eq("chapter_id", chapterId);

  if (!challenges || challenges.length === 0) {
    return NextResponse.json({
      reviews: [],
      summary: summarizeReviewStatuses([], 0),
      totalSubmissions: 0,
      limit: QUERY_LIMITS.codeReviewsPerChallenge,
      truncated: false,
    });
  }

  const challengeIds = challenges.map((c) => c.id as string);

  const limit = QUERY_LIMITS.codeReviewsPerChallenge;

  // Count submissions (the pending denominator) and fetch review rows. We only
  // need the lightweight status fields here, not the full review_content blob.
  const { count: submissionCount } = await adminClient
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .in("challenge_id", challengeIds);

  const { data: subRows } = await adminClient
    .from("submissions")
    .select("id")
    .in("challenge_id", challengeIds)
    .limit(limit);

  const submissionIds = (subRows ?? []).map((r) => r.id as string);

  let reviewRows: Array<Record<string, unknown>> = [];
  if (submissionIds.length > 0) {
    const { data } = await adminClient
      .from("code_reviews")
      .select("submission_id, status, progress, cost_usd")
      .in("submission_id", submissionIds);
    reviewRows = (data ?? []) as Array<Record<string, unknown>>;
  }

  const reviews = reviewRows.map((row) => ({
    submissionId: row.submission_id as string,
    status: row.status as CodeReviewStatus,
    progress: (row.progress as string) ?? null,
    costUsd: (row.cost_usd as number) ?? null,
  }));

  const totalSubmissions = submissionCount ?? submissionIds.length;
  const summary = summarizeReviewStatuses(reviews, totalSubmissions);

  return NextResponse.json({
    reviews,
    summary,
    totalSubmissions,
    limit,
    // We fetched at most `limit` submissions; if there are more, the list is
    // truncated and the page shows a LimitBanner.
    truncated: submissionIds.length >= limit,
  });
}
