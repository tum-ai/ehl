import type { CodeReviewStatus } from "@/lib/types";

/**
 * Pure aggregation + polling helpers for the admin code-review status overview.
 * Kept side-effect free so they are trivially unit-testable and reusable by both
 * the API endpoint (server) and the admin page (client).
 */

export interface StatusSummary {
  pending: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  /** Total submissions considered (including those with no review row = pending). */
  total: number;
  /** Sum of cost_usd across all reviews. */
  totalCostUsd: number;
  /** True while any review is queued or processing (worker still has work). */
  inFlight: boolean;
}

/** A minimal review shape — only the fields the summary needs. */
export interface SummarizableReview {
  status: CodeReviewStatus;
  costUsd?: number | null;
}

/**
 * Aggregate counts by status across a chapter's submissions.
 *
 * `totalSubmissions` is the denominator: any submission without a review row (or
 * with an explicit "pending" review) counts as pending. This guarantees the
 * counts always sum to the number of submissions, so the admin never sees a
 * silently-missing review.
 */
export function summarizeReviewStatuses(
  reviews: SummarizableReview[],
  totalSubmissions: number
): StatusSummary {
  let queued = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  let pendingExplicit = 0;
  let totalCostUsd = 0;

  for (const r of reviews) {
    switch (r.status) {
      case "queued":
        queued++;
        break;
      case "processing":
        processing++;
        break;
      case "completed":
        completed++;
        break;
      case "failed":
        failed++;
        break;
      default:
        pendingExplicit++;
        break;
    }
    totalCostUsd += r.costUsd ?? 0;
  }

  // Submissions with no review row are pending too. Never let pending go negative
  // (defensive: more review rows than submissions should not happen, but clamp).
  const withRow = queued + processing + completed + failed + pendingExplicit;
  const pending = Math.max(0, totalSubmissions - withRow) + pendingExplicit;

  return {
    pending,
    queued,
    processing,
    completed,
    failed,
    total: totalSubmissions,
    totalCostUsd,
    inFlight: queued > 0 || processing > 0,
  };
}

/**
 * Should the admin page keep polling for status updates?
 *
 * Poll only while work is in flight (something queued or processing). Stop once
 * everything has settled (completed/failed/pending) so we don't hammer the API
 * forever. Pure function of the current set of statuses.
 */
export function shouldKeepPolling(statuses: Iterable<CodeReviewStatus>): boolean {
  for (const s of statuses) {
    if (s === "queued" || s === "processing") return true;
  }
  return false;
}
