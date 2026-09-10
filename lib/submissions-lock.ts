// Core submission-locking logic. Intentionally NOT a "use server" module:
// keeping it out of an action file means it is not exposed as a callable
// server-action endpoint. Callers are the guarded `lockSubmissions` action
// (lib/actions/submissions.ts) and the secret-gated cron route. Both are
// trusted, server-to-server entry points.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseGitHubRepo,
  snapshotRepo,
  addCollaborators,
  fetchCheckpointBranchIntoFork,
} from "@/lib/github";
import type { CollaboratorInvitee } from "@/lib/github";
import type { SubmissionFieldConfig } from "@/lib/types";

export function makeSnapshotName(teamName: string, chapterSlug: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug(chapterSlug)}-${slug(teamName)}`;
}

/**
 * Lock all submissions for a challenge and snapshot their repos.
 * Trusted callers only (admin-guarded action or cron). Never export this
 * from a "use server" module.
 */
export async function lockSubmissionsCore(challengeId: string) {
  const adminClient = createAdminClient();

  // Jury members we could NOT put on a snapshot fork. Returned to the caller so
  // an admin sees it at lock time, while there is still time to collect the
  // missing GitHub username, rather than discovering it during judging.
  const failedJuryInvites: string[] = [];

  // Lock all submissions for this challenge
  const { error } = await adminClient
    .from("submissions")
    .update({ is_locked: true })
    .eq("challenge_id", challengeId);

  if (error) return { error: error.message };

  // Final snapshot for all submissions with repo fields
  try {
    const { data: challenge } = await adminClient
      .from("challenges")
      .select("submission_fields, chapter_id, invite_jury_to_forks")
      .eq("id", challengeId)
      .single();

    if (!challenge?.submission_fields) return { success: true, failedJuryInvites };

    const submissionFields = challenge.submission_fields as SubmissionFieldConfig[];
    const repoFields = submissionFields.filter((f) => f.type === "repo");
    if (repoFields.length === 0) return { success: true, failedJuryInvites };

    // Get all submissions for this challenge
    const { data: submissions } = await adminClient
      .from("submissions")
      .select("id, team_id, fields")
      .eq("challenge_id", challengeId);

    if (!submissions || submissions.length === 0) return { success: true, failedJuryInvites };

    // Get chapter slug for naming
    const { data: chapterData } = await adminClient
      .from("chapters")
      .select("slug")
      .eq("id", challenge.chapter_id)
      .single();

    // Get jury identities only if invite_jury_to_forks is enabled. The stored
    // github_username is what actually gets them onto a PRIVATE fork; email is
    // carried along only as the legacy lookup fallback (see addCollaborators).
    const shouldInviteJury = challenge.invite_jury_to_forks === true;
    let juryInvitees: CollaboratorInvitee[] = [];

    if (shouldInviteJury) {
      const { data: juryAssignments } = await adminClient
        .from("jury_assignments")
        .select("user_id")
        .eq("challenge_id", challengeId);

      if (juryAssignments && juryAssignments.length > 0) {
        const juryUserIds = juryAssignments.map((ja) => ja.user_id as string);
        const { data: juryProfiles } = await adminClient
          .from("profiles")
          .select("email, github_username")
          .in("id", juryUserIds);
        juryInvitees = (juryProfiles ?? [])
          .filter((p) => !!p.email)
          .map((p) => ({
            email: p.email as string,
            githubUsername: (p.github_username as string | null) ?? null,
          }));
      }
    }

    // Snapshot each submission's repo and grant jury access
    for (const sub of submissions) {
      const fields = (sub.fields as Record<string, string>) ?? {};

      // Get team name for naming
      const { data: team } = await adminClient
        .from("teams")
        .select("name")
        .eq("id", sub.team_id)
        .single();

      for (const rf of repoFields) {
        const repoUrl = fields[rf.key];
        if (!repoUrl) continue;

        const parsed = parseGitHubRepo(repoUrl);
        if (!parsed) continue;

        const snapshotName = makeSnapshotName(
          team?.name || (sub.team_id as string),
          chapterData?.slug || (challenge.chapter_id as string)
        );

        const result = await snapshotRepo(
          parsed.owner,
          parsed.repo,
          snapshotName,
          `EHL final submission snapshot: ${team?.name || sub.team_id}`
        );

        if ("snapshotUrl" in result) {
          await adminClient
            .from("submissions")
            .update({ fork_url: result.snapshotUrl })
            .eq("id", sub.id);

          // Capture the Entire session-history branch into the private fork
          // (best-effort; never blocks the deadline lock).
          await fetchCheckpointBranchIntoFork(parsed.owner, parsed.repo, snapshotName).catch(
            (e) => console.error("Checkpoint branch capture failed:", e)
          );

          // Add jury members as collaborators to the snapshot. Failures are
          // collected rather than swallowed: a juror with no access to a
          // private fork cannot judge, and that must not be discovered only
          // when the jury complains.
          if (shouldInviteJury && juryInvitees.length > 0) {
            const snapshotParsed = parseGitHubRepo(result.snapshotUrl);
            if (snapshotParsed) {
              const inviteResults = await addCollaborators(
                snapshotParsed.owner,
                snapshotParsed.repo,
                juryInvitees
              );
              for (const r of inviteResults.filter((x) => !x.invited)) {
                failedJuryInvites.push(
                  `${r.email} -> ${snapshotParsed.owner}/${snapshotParsed.repo}: ${r.error ?? "unknown error"}`
                );
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Snapshot at deadline failed:", e);
  }

  if (failedJuryInvites.length > 0) {
    console.error("Jury fork invites failed:", failedJuryInvites.join("; "));
  }

  return { success: true, failedJuryInvites };
}
