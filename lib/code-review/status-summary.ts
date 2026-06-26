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

export interface WorkerHealth {
  /** "ok" while work is progressing or settled; "stuck" / "dispatch_failed" otherwise. */
  state: "idle" | "ok" | "stuck" | "dispatch_failed";
  message: string | null;
}

/** A review row enriched with queue timing/progress for health detection. */
export interface HealthReview {
  status: CodeReviewStatus;
  progress?: string | null;
  queuedAt?: string | null;
}

/**
 * Decide whether the queue looks healthy, given the current reviews and the last
 * dispatch outcome. Pure (takes nowMs so it is deterministic in tests).
 *
 * - dispatch_failed: the last dispatch attempt failed -> the worker was never
 *   triggered, so anything queued will sit forever until retried. Highest signal.
 * - stuck: there are queued rows older than `staleMs`, none are processing, and
 *   none show progress -> the worker is not picking them up.
 * - ok: something is processing or progressing, or the queue is fresh.
 * - idle: nothing queued or processing.
 */
export function computeWorkerHealth(
  reviews: HealthReview[],
  lastDispatch: { ok: boolean; message: string | null } | null,
  nowMs: number,
  staleMs = 3 * 60_000
): WorkerHealth {
  const queued = reviews.filter((r) => r.status === "queued");
  const processing = reviews.filter((r) => r.status === "processing");
  const inFlight = queued.length > 0 || processing.length > 0;

  if (!inFlight) {
    return { state: "idle", message: null };
  }

  // A failed dispatch means nothing will run until retried — surface it even if
  // the rows were only just queued.
  if (lastDispatch && lastDispatch.ok === false) {
    return {
      state: "dispatch_failed",
      message:
        lastDispatch.message ??
        "The last attempt to trigger the worker failed. Reviews will stay queued until you retry dispatch.",
    };
  }

  // Stuck: queued long enough that a running worker should have started, but
  // nothing is processing and no progress has been written.
  const anyProgress = reviews.some((r) => !!r.progress);
  const oldestStaleQueued = queued.some((r) => {
    if (!r.queuedAt) return false;
    return nowMs - new Date(r.queuedAt).getTime() > staleMs;
  });
  if (processing.length === 0 && !anyProgress && oldestStaleQueued) {
    return {
      state: "stuck",
      message:
        "Reviews have been queued for a while but no worker has picked them up. The GitHub Actions worker may not be running. Try Retry dispatch, or run the process-code-reviews workflow manually.",
    };
  }

  return { state: "ok", message: null };
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
