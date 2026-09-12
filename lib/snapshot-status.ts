/**
 * Snapshot (repo fork) status for a submission.
 *
 * Every submission with a GitHub repo field is forked into the EHL snapshot org
 * so the jury reads a copy under EHL control. Two things can leave that fork
 * missing: a GitHub failure at submit time (secondary rate limit during the
 * deadline rush, an expired bot token, a team revoking access) or the same
 * failure again during the deadline lock.
 *
 * Neither path blocks the participant, by design, so `submissions.fork_url IS
 * NULL` is the ONLY durable record that a fork is owed. This module turns that
 * column into the status admins act on. Keep it dependency-free so it can be
 * used from server components, server actions and unit tests alike.
 */

/** Shown to the team when their submission saved but the fork did not happen. */
export const SNAPSHOT_WARNING =
  "Your submission is saved. We could not archive a copy of your repository yet: organizers will retry automatically. Please keep the repository accessible and do not change its visibility.";

export type SnapshotState = "snapshotted" | "missing" | "not_applicable";

/**
 * Does this submission carry a GitHub repo at all? Mirrors the check the
 * deadline cron already uses, so a submission counted as "missing" here is
 * exactly one the snapshot path would have tried to fork.
 */
export function hasRepoField(fields: Record<string, unknown> | null | undefined): boolean {
  if (!fields) return false;
  return Object.values(fields).some(
    (v) => typeof v === "string" && v.includes("github.com")
  );
}

export function snapshotState(submission: {
  forkUrl: string | null | undefined;
  fields: Record<string, unknown> | null | undefined;
}): SnapshotState {
  if (!hasRepoField(submission.fields)) return "not_applicable";
  return submission.forkUrl ? "snapshotted" : "missing";
}

/**
 * Submissions still owed a fork. This is the retry worklist: an admin runs it
 * once the rate limit window clears or the token is rotated.
 */
export function missingSnapshots<
  T extends { forkUrl: string | null | undefined; fields: Record<string, unknown> | null | undefined }
>(submissions: T[]): T[] {
  return submissions.filter((s) => snapshotState(s) === "missing");
}

export function snapshotStatusLabel(state: SnapshotState): string {
  switch (state) {
    case "snapshotted":
      return "Snapshotted";
    case "missing":
      return "Not snapshotted";
    case "not_applicable":
      return "No repo";
  }
}

/** Result of the admin snapshot retry. Explicit so callers can narrow on `error`. */
export type SnapshotRetryResult =
  | { error: string }
  | { success: true; attempted: number; succeeded: number; failures: string[] };
