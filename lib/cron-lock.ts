import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Atomic, self-healing lock for cron runs, backed by the `try_acquire_cron_lock`
 * / `release_cron_lock` Postgres functions (migration 00048).
 *
 * The deadline-check cron runs every minute, but its submissions->pitching branch
 * can exceed a minute (GitHub forking). Wrapping a run in this lock guarantees that
 * an overlapping run exits immediately instead of double-processing a chapter.
 *
 * `ttlSeconds` should comfortably exceed the worst-case run time; if a run crashes
 * without releasing, the lock auto-expires after the TTL and the next run reclaims it.
 */
export async function tryAcquireCronLock(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("try_acquire_cron_lock", {
    lock_key: key,
    ttl_seconds: ttlSeconds,
  });
  if (error) {
    // Fail CLOSED: if we can't confirm we hold the lock, do not run. A skipped
    // minute is harmless (the next minute retries); a double-run is not.
    console.error(`[cron-lock] Failed to acquire "${key}":`, error.message);
    return false;
  }
  return data === true;
}

/** Best-effort release so a fast clean run frees the lock before its TTL. */
export async function releaseCronLock(key: string): Promise<void> {
  const adminClient = createAdminClient();
  const { error } = await adminClient.rpc("release_cron_lock", { lock_key: key });
  if (error) {
    // Non-fatal: the TTL will expire the lock anyway.
    console.error(`[cron-lock] Failed to release "${key}":`, error.message);
  }
}
