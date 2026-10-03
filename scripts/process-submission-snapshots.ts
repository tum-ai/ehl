import { createAdminClient } from "../lib/supabase/admin";
import { getGitHubConfiguration } from "../lib/github";
import { isProductionDatabase } from "../lib/dev-login";
import { SnapshotWorker } from "../lib/submission-snapshots/worker";
import { transferCapturedRepository } from "../lib/submission-snapshots/git-transfer";
import { runWithWorkerLease } from "../lib/submission-snapshots/lease";

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
  // A short lease renewed while alive: a crashed run blocks the queue for at
  // most WORKER_LEASE_SECONDS instead of a fixed half hour.
  await runWithWorkerLease(db, async () => {
    const { token, org } = await getGitHubConfiguration();
    if (!token) throw new Error("GitHub token is not configured");
    const worker = new SnapshotWorker(db, token, org, (copy, heartbeat) =>
      transferCapturedRepository(copy, token, heartbeat),
    );
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && (await worker.runOne())) {
      /* stop when no job is due */
    }
  });
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Snapshot worker failed",
  );
  process.exitCode = 1;
});
