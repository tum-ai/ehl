import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";
import {
  summarizeReviewStatuses,
  computeWorkerHealth,
} from "@/lib/code-review/status-summary";
import { getCodeReviewLastDispatch } from "@/lib/settings";
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

  // Per-row detail for the DISPLAYED (limited) list only.
  let reviewRows: Array<Record<string, unknown>> = [];
  if (submissionIds.length > 0) {
    const { data } = await adminClient
      .from("code_reviews")
      .select("submission_id, status, progress, cost_usd, queued_at")
      .in("submission_id", submissionIds);
    reviewRows = (data ?? []) as Array<Record<string, unknown>>;
  }

  const reviews = reviewRows.map((row) => ({
    submissionId: row.submission_id as string,
    status: row.status as CodeReviewStatus,
    progress: (row.progress as string) ?? null,
    costUsd: (row.cost_usd as number) ?? null,
    queuedAt: (row.queued_at as string) ?? null,
  }));

  const totalSubmissions = submissionCount ?? submissionIds.length;

  // The SUMMARY (counts + "anything in flight?") must reflect ALL reviews in the
  // chapter, not just the displayed subset. Building it from the limited list
  // would hide queued/processing rows beyond the limit, so polling could stop
  // early and "Queue All" could requeue still-running reviews. code_reviews has
  // no challenge_id, so resolve EVERY submission id for the chapter's challenges
  // (ids only) and aggregate all their reviews — intentionally unbounded by the
  // display limit. The displayed `reviews` list stays limited (LimitBanner).
  let allReviews = reviews;
  if ((submissionCount ?? 0) > submissionIds.length) {
    const { data: allSubRows } = await adminClient
      .from("submissions")
      .select("id")
      .in("challenge_id", challengeIds);
    const allSubmissionIds = (allSubRows ?? []).map((r) => r.id as string);
    const { data: allReviewRows } = await adminClient
      .from("code_reviews")
      .select("submission_id, status, progress, cost_usd, queued_at")
      .in("submission_id", allSubmissionIds);
    allReviews = (allReviewRows ?? []).map((row) => ({
      submissionId: row.submission_id as string,
      status: row.status as CodeReviewStatus,
      progress: (row.progress as string) ?? null,
      costUsd: (row.cost_usd as number) ?? null,
      queuedAt: (row.queued_at as string) ?? null,
    }));
  }
  const summary = summarizeReviewStatuses(allReviews, totalSubmissions);

  // Persistent worker-health signal so a stuck/failed queue is never a silent
  // black box. Computed across ALL reviews in the chapter (not just displayed).
  const lastDispatch = await getCodeReviewLastDispatch();
  const workerHealth = computeWorkerHealth(
    allReviews.map((r) => ({
      status: r.status,
      progress: r.progress,
      queuedAt: r.queuedAt,
    })),
    lastDispatch ? { ok: lastDispatch.ok, message: lastDispatch.message } : null,
    Date.now()
  );

  return NextResponse.json({
    reviews,
    summary,
    workerHealth,
    lastDispatch,
    totalSubmissions,
    limit,
    // We fetched at most `limit` submissions; if there are more, the list is
    // truncated and the page shows a LimitBanner.
    truncated: submissionIds.length >= limit,
  });
}
