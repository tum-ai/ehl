"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckinStatusForUsers } from "@/lib/queries/checkin";
import { logEvent } from "@/lib/event-log";
import { MIN_CHALLENGE_ROSTER, MAX_TEAM_SIZE } from "@/lib/config/limits";
import { lockSubmissionsCore, retrySnapshotsCore } from "@/lib/submissions-lock";
import { type SnapshotRetryResult } from "@/lib/snapshot-status";
import { BLOCK_ACTION, type BlockReason } from "@/lib/submission-blocks";
import { prepareSubmissionRepositories, SubmissionVerificationError } from "@/lib/submission-snapshots/prepare";
import type { SubmissionReceipt, SubmissionRequirements } from "@/lib/submission-snapshots/types";
import { apiLimiter, checkRateLimit } from "@/lib/ratelimit";

export async function registerForChallenge(
  chapterId: string,
  challengeId: string,
  teamId: string,
  // Deprecated: the roster is always derived server-side from the team's actual
  // members. This parameter is ignored (kept for the existing call signature) so
  // a crafted client roster cannot pad team size or include non-members.
  _roster: string[] = []
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // adminClient is intentional: RLS "President manage registrations" policy only allows
  // the president, but this action also needs to read chapter_unlocks and chapter status
  // for any authenticated team member. Manual auth checks above enforce access control.
  const adminClient = createAdminClient();

  // Verify user is the team president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", teamId)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can register for challenges." };
  }

  // Verify chapter is still in challenge selection phase
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("status, challenge_selection_deadline")
    .eq("id", chapterId)
    .single();

  if (!chapter || chapter.status !== "challenge_selection") {
    return { error: "Challenge selection is closed." };
  }

  // Check actual deadline (cron may not have run yet)
  if (chapter.challenge_selection_deadline && new Date(chapter.challenge_selection_deadline) <= new Date()) {
    return { error: "The challenge selection deadline has passed." };
  }

  // Always derive the roster from the team's ACTUAL members. We never trust a
  // client-supplied roster here: doing so would let a solo president pad the
  // team to the minimum (or include non-members) by calling the action directly.
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  const finalRoster = Array.from(
    new Set((members ?? []).map((m) => m.user_id as string))
  );

  // Enforce the minimum team size: a team must have MIN_CHALLENGE_ROSTER to
  // MAX_TEAM_SIZE members to select a challenge (a single-person team cannot
  // register). This is the same domain invariant the event-hub registerChallenge
  // action enforces, and it is load-bearing for this path.
  if (finalRoster.length < MIN_CHALLENGE_ROSTER || finalRoster.length > MAX_TEAM_SIZE) {
    return {
      error: `Your team must have ${MIN_CHALLENGE_ROSTER} to ${MAX_TEAM_SIZE} members to register for a challenge.`,
    };
  }

  // Verify all roster members are checked in for this chapter
  const checkinStatus = await getCheckinStatusForUsers(finalRoster, chapterId);
  const notCheckedIn = finalRoster.filter((id) => !checkinStatus.get(id));
  if (notCheckedIn.length > 0) {
    const { data: notCheckedInProfiles } = await adminClient
      .from("profiles")
      .select("id, name")
      .in("id", notCheckedIn);
    const names = (notCheckedInProfiles ?? [])
      .map((p) => (p.name as string) || "Unknown")
      .join(", ");
    return {
      error: `All roster members must be checked in. Not checked in: ${names}`,
    };
  }

  // Check if already registered for this chapter
  const { data: existing } = await adminClient
    .from("challenge_registrations")
    .select("id, challenge_id")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .single();

  // Capacity check (first come, first served), only relevant when actually
  // moving into this challenge (a no-op re-registration into the same
  // challenge must not be blocked by the team's own existing slot).
  if (!existing || existing.challenge_id !== challengeId) {
    const { data: challengeRow } = await adminClient
      .from("challenges")
      .select("max_teams")
      .eq("id", challengeId)
      .single();

    if (challengeRow?.max_teams !== null && challengeRow?.max_teams !== undefined) {
      const { count: registeredCount } = await adminClient
        .from("challenge_registrations")
        .select("id", { count: "exact", head: true })
        .eq("challenge_id", challengeId);

      if ((registeredCount ?? 0) >= (challengeRow.max_teams as number)) {
        return { error: "This challenge is full." };
      }
    }
  }

  if (existing) {
    // Update existing registration (switch challenge)
    const { error } = await adminClient
      .from("challenge_registrations")
      .update({ challenge_id: challengeId, roster: finalRoster })
      .eq("id", existing.id);

    if (error) return { error: error.message };
  } else {
    // Insert new registration
    const { error } = await adminClient.from("challenge_registrations").insert({
      chapter_id: chapterId,
      challenge_id: challengeId,
      team_id: teamId,
      roster: finalRoster,
    });

    if (error) return { error: error.message };
  }

  logEvent({
    action: "registration.created",
    entityType: "challenge_registration",
    entityId: challengeId,
    actorId: user.id,
    actorType: "participant",
    delta: { created: { chapter_id: chapterId } },
  });

  revalidatePath(`/matches`);
  return { success: true, challengeId };
}

/**
 * Record a submission attempt that was refused, then return the participant's
 * error unchanged.
 *
 * A blocked submission writes no submissions row, so without this it left no
 * trace at all and organizers learned about stuck teams only when someone came
 * to the desk. Logged as the acting participant so the admin view can count
 * DISTINCT teams, not just attempts.
 */
function blockSubmission(
  reason: BlockReason,
  message: string,
  ctx: { userId: string; challengeId: string; teamId: string }
): { error: string } {
  logEvent({
    action: BLOCK_ACTION,
    entityType: "submission",
    entityId: ctx.challengeId,
    actorId: ctx.userId,
    actorType: "participant",
    delta: { blocked: { reason, team_id: ctx.teamId } },
  });
  return { error: message };
}

export async function submitProject(formData: FormData) {
  const challengeId = formData.get("challengeId") as string;
  const teamId = formData.get("teamId") as string;
  const projectName = formData.get("projectName") as string;
  const description = formData.get("shortDescription");
  const shortDescription = typeof description === "string" ? description || null : null;
  const fieldsJson = formData.get("fields") as string;
  const techStackJson = formData.get("techStack") as string;

  if (typeof challengeId !== "string" || typeof teamId !== "string" || typeof projectName !== "string" || !challengeId || !teamId || !projectName) {
    return { error: "Challenge, team, and project name are required." };
  }
  if ((description !== null && typeof description !== "string") || projectName.trim().length > 200 || (shortDescription?.length ?? 0) > 300) {
    return { error: "Invalid project details." };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Not authenticated." };

  let fields: Record<string, string> = {};
  let techStack: string[] = [];

  try {
    if (fieldsJson) fields = JSON.parse(fieldsJson);
    if (techStackJson) techStack = JSON.parse(techStackJson);
  } catch {
    return { error: "Invalid data format." };
  }

  if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
      !Object.values(fields).every(v => typeof v === "string" && v.length <= 10000) ||
      !Array.isArray(techStack) || techStack.length > 30 ||
      !techStack.every(v => typeof v === "string" && v.length <= 100)) {
    return { error: "Invalid submission fields or technology stack." };
  }
  const context = { userId: user.id, challengeId, teamId };
  const refused = (error: { details?: string; message: string }) => {
    const reasons: BlockReason[] = ["not_team_member", "not_checked_in", "not_registered", "submissions_locked", "deadline_passed"];
    return reasons.includes(error.details as BlockReason)
      ? blockSubmission(error.details as BlockReason, error.message, context)
      : { error: error.message };
  };
  // Intentional, narrowly scoped service access, matching the existing Submit
  // model: participants cannot call either RPC. Identity comes only from the
  // verified session above, never form data. SQL checks membership, check-in,
  // registration and deadline again in the atomic save under the chapter lock.
  const adminClient = createAdminClient();
  const { data, error: eligibilityError } = await adminClient.rpc("submission_requirements", { p_user: user.id, p_challenge: challengeId, p_team: teamId });
  if (eligibilityError) return refused(eligibilityError);
  if (!data || !Array.isArray(data.submission_fields)) return { error: "Cannot read submission requirements." };
  const requirements = data as SubmissionRequirements;
  for (const field of requirements.submission_fields) {
    if (field.type === "repo" && fields[field.key]) fields[field.key] = fields[field.key].trim();
  }
  const limit = await checkRateLimit(apiLimiter, `submission:${user.id}`);
  if (limit.limited) return { error: limit.error };
  let receipt: SubmissionReceipt;
  try {
    const repo_snapshots = await prepareSubmissionRepositories(fields, requirements);
    receipt = { user_id: user.id, challenge_id: challengeId, team_id: teamId,
      project_name: projectName, short_description: shortDescription, fields, tech_stack: techStack,
      requirements, repo_snapshots };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository verification could not finish. Please retry.";
    return blockSubmission(error instanceof SubmissionVerificationError ? error.reason : "entire_check_unavailable", message, context);
  }
  const { error } = await adminClient.rpc("receive_submission", { p_submission: receipt });
  if (error) {
    return refused(error);
  }
  logEvent({ action: "submission.created", entityType: "submission", entityId: challengeId,
    actorId: user.id, actorType: "participant", delta: { created: { project_name: projectName } } });
  revalidatePath("/dashboard");
  return { success: true };
}

export async function lockSubmissions(challengeId: string) {
  const { requireAdminAction } = await import("@/lib/admin-auth");
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  return lockSubmissionsCore(challengeId);
}

/**
 * Admin retry for submissions whose repo fork is still missing (fork_url NULL).
 *
 * Exists because neither the submit path nor the deadline lock fails loudly to
 * the participant when GitHub refuses a fork: the gap has to be closable by an
 * operator once the rate limit window clears or the bot token is rotated,
 * BEFORE the jury tries to open a private repo they cannot read.
 *
 * Pass a submissionId for one team, or a chapterId for every missing fork in a
 * match. Idempotent, so it is safe to press twice.
 */
export async function retrySnapshots(opts: {
  submissionId?: string;
  chapterId?: string;
}): Promise<SnapshotRetryResult> {
  const { requireAdminAction } = await import("@/lib/admin-auth");
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  if (!opts.submissionId && !opts.chapterId) {
    return { error: "A submission or chapter must be specified." };
  }

  const result = await retrySnapshotsCore(opts);

  revalidatePath("/admin/submissions");
  if (opts.chapterId) revalidatePath(`/admin/chapters/${opts.chapterId}`);

  return { success: true as const, ...result };
}
