import type { SupabaseClient } from "@supabase/supabase-js";

// Jurors open private copies while pitching starts, so a crashed or killed
// worker must not hold the queue. The lease is short and renewed while the run
// is alive; a dead run stops renewing and the next run starts within the lease.
// Job leases and revision checks keep a briefly overlapping run safe.
export const WORKER_LOCK_KEY = "snapshot:worker";
export const WORKER_LEASE_SECONDS = 90;
export const WORKER_LEASE_RENEW_MS = 30_000;
// Covers an Actions run booting before it takes the worker lease.
export const DISPATCH_LOCK_SECONDS = 90;

/** Runs `work` while holding a renewed worker lease. Returns false if another live run holds it. */
export async function runWithWorkerLease(
  db: SupabaseClient,
  work: () => Promise<void>,
): Promise<boolean> {
  const { data: locked, error } = await db.rpc("try_acquire_cron_lock", {
    lock_key: WORKER_LOCK_KEY,
    ttl_seconds: WORKER_LEASE_SECONDS,
  });
  if (error) throw new Error("Cannot acquire snapshot worker lock");
  if (!locked) return false;
  const renew = setInterval(() => {
    const now = Date.now();
    Promise.resolve(
      db
        .from("app_settings")
        .update({
          expires_at: new Date(now + WORKER_LEASE_SECONDS * 1000).toISOString(),
          updated_at: new Date(now).toISOString(),
        })
        .eq("key", WORKER_LOCK_KEY)
        .not("expires_at", "is", null),
    ).then(
      ({ error: renewError }) => {
        if (renewError) console.error("Snapshot worker lease renewal failed");
      },
      () => console.error("Snapshot worker lease renewal failed"),
    );
  }, WORKER_LEASE_RENEW_MS);
  try {
    await work();
  } finally {
    clearInterval(renew);
    await db.rpc("release_cron_lock", { lock_key: WORKER_LOCK_KEY });
  }
  return true;
}
