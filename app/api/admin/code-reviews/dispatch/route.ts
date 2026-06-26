import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { dispatchCodeReviewWorker } from "@/lib/code-review/dispatch";
import { recordCodeReviewDispatch } from "@/lib/settings";

/**
 * Manually (re)trigger the code-review worker without re-queuing reviews. Used by
 * the admin "Retry dispatch" button when reviews are stuck Queued because the
 * worker was never triggered (bad token/repo, GitHub error, or a missed run).
 * The outcome is returned AND persisted so it stays visible after a reload.
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const result = await dispatchCodeReviewWorker();
  if (!result.ok) {
    console.error(`[code-review dispatch retry] ${result.message}`);
  }

  await recordCodeReviewDispatch({
    ok: result.ok,
    attempted: result.attempted,
    message: "message" in result ? result.message : null,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ dispatch: result });
}
