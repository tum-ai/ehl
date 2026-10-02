import { createAdminClient } from "../lib/supabase/admin";
import { getGitHubConfiguration } from "../lib/github";
import { isProductionDatabase } from "../lib/dev-login";
import { SnapshotWorker } from "../lib/submission-snapshots/worker";
import { transferCapturedRepository } from "../lib/submission-snapshots/git-transfer";

async function main() {
  // Reuse the existing deployment identity check, not two copies of one secret.
  const environment = process.env.SNAPSHOT_WORKER_ENV;
  if (
    !["test", "production"].includes(environment ?? "") ||
    (environment === "production") !== isProductionDatabase()
  )
    throw new Error(
      "Snapshot worker database identity does not match its environment",
    );
  const db = createAdminClient();
  const { data: locked, error } = await db.rpc("try_acquire_cron_lock", {
    lock_key: "snapshot:worker",
    ttl_seconds: 1800,
  });
  if (error) throw new Error("Cannot acquire snapshot worker lock");
  if (!locked) return;
  try {
    const { token, org } = await getGitHubConfiguration();
    if (!token) throw new Error("GitHub token is not configured");
    const worker = new SnapshotWorker(db, token, org, (copy, heartbeat) =>
      transferCapturedRepository(copy, token, heartbeat),
    );
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && (await worker.runOne())) {
      /* stop when no job is due */
    }
  } finally {
    await db.rpc("release_cron_lock", { lock_key: "snapshot:worker" });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Snapshot worker failed",
  );
  process.exitCode = 1;
});
