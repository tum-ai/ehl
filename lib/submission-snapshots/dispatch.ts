import type { SupabaseClient } from "@supabase/supabase-js";
import { isDevLoginEnabled } from "@/lib/dev-login";
import { DISPATCH_LOCK_SECONDS, WORKER_LOCK_KEY } from "./lease";

/** Called by the existing cron, never by Submit. Idle events make no GitHub call. */
export async function dispatchPendingSnapshots(
  db: SupabaseClient,
): Promise<void> {
  const now = new Date().toISOString();
  const { count, error } = await db
    .from("submission_snapshot_jobs")
    .select("submission_id", { head: true, count: "exact" })
    .or(
      `and(status.eq.queued,next_attempt_at.lte.${now}),and(status.eq.running,lease_until.lt.${now})`,
    );
  if (error) throw new Error("Cannot inspect pending snapshots");
  if (!count) return;
  const { data: active, error: activeError } = await db
    .from("app_settings")
    .select("key")
    .eq("key", WORKER_LOCK_KEY)
    .gt("expires_at", now)
    .maybeSingle();
  if (activeError) throw new Error("Cannot inspect snapshot worker lease");
  if (active) return;
  const token = process.env.GITHUB_TOKEN,
    repo = process.env.GITHUB_REPO;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("Snapshot dispatch needs GITHUB_TOKEN and GITHUB_REPO");
  const { data: locked, error: lockError } = await db.rpc(
    "try_acquire_cron_lock",
    { lock_key: "snapshot:dispatch", ttl_seconds: DISPATCH_LOCK_SECONDS },
  );
  if (lockError) throw new Error("Cannot acquire snapshot dispatch lock");
  if (!locked) return;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          event_type: isDevLoginEnabled()
            ? "process-submission-snapshots-test"
            : "process-submission-snapshots",
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Snapshot worker dispatch failed (HTTP ${response.status}); saved jobs remain queued`,
      );
  } catch (error) {
    await db.rpc("release_cron_lock", { lock_key: "snapshot:dispatch" });
    throw error;
  }
}
