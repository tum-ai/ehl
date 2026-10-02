// Trusted entry points only: guarded admin actions and the existing deadline cron.
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGitHubRepo } from "@/lib/github";

export function makeSnapshotName(
  teamName: string,
  chapterSlug: string,
): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  return `${slug(chapterSlug)}-${slug(teamName)}`;
}
/** Lock and enqueue atomically. The deadline never waits for repository copies. */
export async function lockSubmissionsCore(challengeId: string) {
  const { error } = await createAdminClient().rpc("lock_submission_receipts", {
    p_challenge: challengeId,
  });
  if (error) return { error: error.message };
  return { success: true, failedJuryInvites: [], failedSnapshots: [] };
}
/** Existing admin retry now requeues the copy instead of making GitHub calls. */
export async function retrySnapshotsCore(opts: {
  chapterId?: string;
  submissionId?: string;
}) {
  const db = createAdminClient();
  const failures: string[] = [];
  let query = db.from("submissions").select("id,fields").or("fork_url.is.null,snapshot_error.not.is.null");
  if (opts.submissionId) query = query.eq("id", opts.submissionId);
  else if (opts.chapterId) {
    const { data, error } = await db
      .from("challenges")
      .select("id")
      .eq("chapter_id", opts.chapterId);
    if (error)
      return {
        attempted: 0,
        queued: 0,
        succeeded: 0,
        failures: [error.message],
      };
    if (!data?.length)
      return { attempted: 0, queued: 0, succeeded: 0, failures };
    query = query.in(
      "challenge_id",
      data.map((c) => c.id),
    );
  } else
    return {
      attempted: 0,
      queued: 0,
      succeeded: 0,
      failures: ["A submission or chapter is required."],
    };
  const { data, error } = await query;
  if (error)
    return { attempted: 0, queued: 0, succeeded: 0, failures: [error.message] };
  let attempted = 0,
    queued = 0;
  for (const submission of data ?? []) {
    if (
      !Object.values(submission.fields ?? {}).some(
        (v) => typeof v === "string" && parseGitHubRepo(v),
      )
    )
      continue;
    attempted++;
    const { error } = await db.rpc("retry_submission_snapshot", {
      p_id: submission.id,
    });
    if (error) failures.push(`${submission.id}: ${error.message}`);
    else queued++;
  }
  return { attempted, queued, succeeded: 0, failures };
}
