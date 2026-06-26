import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { dispatchCodeReviewWorker, type DispatchResult } from "@/lib/code-review/dispatch";
import { recordCodeReviewDispatch } from "@/lib/settings";

const MAX_QUEUED_REVIEWS = QUERY_LIMITS.codeReviewQueueDepth;

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json();
  const { submissionIds, dispatch } = body as {
    submissionIds: string[];
    dispatch?: boolean;
  };

  if (!submissionIds || submissionIds.length === 0) {
    return NextResponse.json(
      { error: "submissionIds required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Check current queue depth to prevent unbounded queuing
  const { count } = await adminClient
    .from("code_reviews")
    .select("*", { count: "exact", head: true })
    .in("status", ["queued", "processing"]);

  const currentQueued = count ?? 0;
  if (currentQueued + submissionIds.length > MAX_QUEUED_REVIEWS) {
    return NextResponse.json(
      { error: `Queue limit reached. ${currentQueued} reviews already queued/processing (max ${MAX_QUEUED_REVIEWS}).` },
      { status: 429 }
    );
  }

  let queued = 0;
  const queuedAt = new Date().toISOString();

  for (const submissionId of submissionIds) {
    const { error } = await adminClient.from("code_reviews").upsert(
      {
        submission_id: submissionId,
        status: "queued",
        review_version: 2,
        // Stamp when it entered the queue + clear stale progress so the console
        // doesn't show a previous run's last step on a re-queue.
        queued_at: queuedAt,
        progress: null,
      },
      { onConflict: "submission_id" }
    );

    if (!error) queued++;
  }

  // Dispatch GitHub Actions workflow to process queued reviews.
  // The dispatch result is surfaced to the admin (NOT swallowed) so a
  // misconfigured token/repo/workflow is visible instead of leaving reviews
  // "Queued" forever with no worker running.
  let dispatchResult: DispatchResult | null = null;
  if (dispatch !== false && queued > 0) {
    dispatchResult = await dispatchCodeReviewWorker();
    if (!dispatchResult.ok) {
      console.error(`[code-review queue] ${dispatchResult.message}`);
    }
    // Persist the outcome so the admin sees it durably (across reloads), not just
    // in a transient banner that vanishes and leaves a silent "Queued".
    await recordCodeReviewDispatch({
      ok: dispatchResult.ok,
      attempted: dispatchResult.attempted,
      message: "message" in dispatchResult ? dispatchResult.message : null,
      at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true, queued, dispatch: dispatchResult });
}
