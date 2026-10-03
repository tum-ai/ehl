import { dispatchPendingSnapshots } from "@/lib/submission-snapshots/dispatch";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { lockSubmissionsCore } from "@/lib/submissions-lock";
import { logEvent } from "@/lib/event-log";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { dispatchCodeReviewWorker } from "@/lib/code-review/dispatch";
import { recordCodeReviewDispatch } from "@/lib/settings";

// Reuse the existing minute cron for deadline closure and dispatch of due jobs.
// Repository transfers run in Actions, never inside the deadline transaction.
export const maxDuration = 300;

const LOCK_KEY = "cron:deadline-check";
// The lease MUST outlive the longest possible live run, otherwise it can expire
// while the original invocation is still working and the next minute's run
// would reclaim it, defeating the
// serialization. So keep TTL well above maxDuration (300s) plus headroom for
// cold-start and scheduler jitter. A clean run releases immediately via the
// finally block; this TTL only governs how long a *crashed* run stays locked
// before self-healing.
const LOCK_TTL_SECONDS = 600;

// Called by Vercel cron or external scheduler to auto-close applications/challenge selection
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access (timing-safe comparison)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, "utf8");
  const actual = Buffer.from(authHeader, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Serialize runs: if a previous minute's run is still working, skip this one.
  const gotLock = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!gotLock) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  try {
    return await runDeadlineCheck();
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}

async function runDeadlineCheck(): Promise<NextResponse> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const transitions: string[] = [];

  // Purge expired verification codes. Each holds an AES-encrypted password in
  // metadata; once expired it is useless and should not be retained.
  {
    const { error } = await adminClient
      .from("verification_codes")
      .delete()
      .lt("expires_at", now);
    if (error) console.error("[cron] Failed to purge expired verification codes:", error.message);
  }

  // Auto-close applications: applications_open -> preparation
  const { data: appChapters } = await adminClient
    .from("chapters")
    .select("id, name, application_deadline")
    .eq("status", "applications_open")
    .not("application_deadline", "is", null)
    .lte("application_deadline", now);

  for (const chapter of appChapters ?? []) {
    const { error } = await adminClient
      .from("chapters")
      .update({ status: "preparation" })
      .eq("id", chapter.id);
    if (error) {
      console.error(`[cron] Failed to advance ${chapter.name} to preparation:`, error.message);
      continue;
    }
    transitions.push(`${chapter.name}: applications_open -> preparation`);
    logEvent({
      action: "chapter.status_changed",
      entityType: "chapter",
      entityId: chapter.id as string,
      actorType: "system",
      delta: { from: "applications_open", to: "preparation", reason: "deadline" },
    });
  }

  // Auto-close challenge selection -> submissions_open on the selection deadline.
  //
  // Match BOTH challenge_selection AND hacking. `hacking` sits between
  // challenge_selection and submissions_open in the flow (lib/types.ts), and an
  // admin running the event may have manually advanced the chapter into it. The
  // public match page renders `hacking` and `submissions_open` identically and
  // there is no separate hacking deadline, so for the purpose of this deadline
  // both source states resolve to submissions_open. Previously this branch only
  // matched challenge_selection, so a chapter sitting in `hacking` was never
  // auto-closed — that was the bug (the selection deadline appeared to do
  // nothing while the submission deadline still worked, because by then the
  // chapter was already in submissions_open).
  const { data: csChapters } = await adminClient
    .from("chapters")
    .select("id, name, status, challenge_selection_deadline")
    .in("status", ["challenge_selection", "hacking"])
    .not("challenge_selection_deadline", "is", null)
    .lte("challenge_selection_deadline", now);

  for (const chapter of csChapters ?? []) {
    const from = chapter.status as string;
    const { error } = await adminClient
      .from("chapters")
      .update({ status: "submissions_open" })
      .eq("id", chapter.id);
    if (error) {
      console.error(`[cron] Failed to advance ${chapter.name} to submissions_open:`, error.message);
      continue;
    }
    transitions.push(`${chapter.name}: ${from} -> submissions_open`);
    logEvent({
      action: "chapter.status_changed",
      entityType: "chapter",
      entityId: chapter.id as string,
      actorType: "system",
      delta: { from, to: "submissions_open", reason: "deadline" },
    });
  }

  // Auto-lock submissions when deadline passes
  const { data: deadlineChapters } = await adminClient
    .from("chapters")
    .select("id, name, submission_deadline")
    .eq("status", "submissions_open")
    .not("submission_deadline", "is", null)
    .lte("submission_deadline", now);

  let reviewsQueued = 0;

  for (const chapter of deadlineChapters ?? []) {
    // Get all challenges for this chapter
    const { data: challenges, error: challengesError } = await adminClient
      .from("challenges")
      .select("id, code_review_enabled")
      .eq("chapter_id", chapter.id);

    if (challengesError) { transitions.push("Could not read challenges to lock"); continue; }
    let lockFailed = false;
    for (const challenge of challenges ?? []) {
      const result = await lockSubmissionsCore(challenge.id);
      if (result?.error) { lockFailed = true; transitions.push(result.error); }

      // The copy worker queues the review after the final snapshot is ready.
    }

    if (lockFailed) continue;
    // Advance status to pitching
    const { error: pitchErr } = await adminClient
      .from("chapters")
      .update({ status: "pitching" })
      .eq("id", chapter.id);
    if (pitchErr) {
      console.error(`[cron] Failed to advance ${chapter.name} to pitching:`, pitchErr.message);
      continue;
    }
    transitions.push(`${chapter.name}: submissions_open -> pitching`);
    logEvent({
      action: "chapter.status_changed",
      entityType: "chapter",
      entityId: chapter.id as string,
      actorType: "system",
      delta: { from: "submissions_open", to: "pitching", reason: "deadline" },
    });
  }

  try { await dispatchPendingSnapshots(adminClient); }
  catch (error) { transitions.push(error instanceof Error ? error.message : "Snapshot dispatch deferred"); }
  const { count: queuedReviews } = await adminClient.from("code_reviews").select("id", { count: "exact", head: true }).eq("status", "queued");
  reviewsQueued = queuedReviews ?? 0;

  // Dispatch GitHub Actions workflow if reviews were queued. Surface the outcome
  // (success OR failure) in the transitions log instead of swallowing it.
  if (reviewsQueued > 0 && await tryAcquireCronLock("snapshot:reviews-dispatch", 300)) {
    const dispatchResult = await dispatchCodeReviewWorker();
    if (dispatchResult.ok) {
      transitions.push(`Dispatched code review processing (${reviewsQueued} queued)`);
    } else {
      console.error(`[deadline-check] ${dispatchResult.message}`);
      transitions.push(`Failed to dispatch code review processing: ${dispatchResult.message}`);
    }
    // Persist the outcome so the admin console shows whether the cron-triggered
    // worker actually ran (same durable signal as the manual queue path).
    await recordCodeReviewDispatch({
      ok: dispatchResult.ok,
      attempted: dispatchResult.attempted,
      message: "message" in dispatchResult ? dispatchResult.message : null,
      at: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    checked: now,
    transitions,
    reviewsQueued,
  });
}
