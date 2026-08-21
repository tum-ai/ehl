"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckinStatusForUsers } from "@/lib/queries/checkin";
import { parseGitHubRepo, snapshotRepo, fetchCheckpointBranchIntoFork } from "@/lib/github";
import { checkCheckpointBranch, entireGateErrorMessage } from "@/lib/entire";
import type { SubmissionFieldConfig } from "@/lib/types";
import { logEvent } from "@/lib/event-log";
import { MIN_CHALLENGE_ROSTER, MAX_TEAM_SIZE } from "@/lib/config/limits";
import { lockSubmissionsCore, makeSnapshotName } from "@/lib/submissions-lock";

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
 * Generate a slug-safe repo name for a snapshot.
 */
export async function submitProject(formData: FormData) {
  const challengeId = formData.get("challengeId") as string;
  const teamId = formData.get("teamId") as string;
  const projectName = formData.get("projectName") as string;
  const shortDescription = (formData.get("shortDescription") as string) || null;
  const fieldsJson = formData.get("fields") as string;
  const techStackJson = formData.get("techStack") as string;

  if (!challengeId || !teamId || !projectName) {
    return { error: "Challenge, team, and project name are required." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  let fields: Record<string, string> = {};
  let techStack: string[] = [];

  try {
    if (fieldsJson) fields = JSON.parse(fieldsJson);
    if (techStackJson) techStack = JSON.parse(techStackJson);
  } catch {
    return { error: "Invalid data format." };
  }

  // adminClient is intentional: RLS "President manage submissions" only allows the
  // president, but any team member can submit. Manual auth checks enforce access.
  const adminClient = createAdminClient();

  // Verify user belongs to this team
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You are not a member of this team." };
  }

  // Verify submitter is checked in for this chapter
  const { data: submitterProfile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (submitterProfile) {
    const { data: challengeForCheckin } = await adminClient
      .from("challenges")
      .select("chapter_id")
      .eq("id", challengeId)
      .single();

    if (challengeForCheckin) {
      const { data: checkinApp } = await adminClient
        .from("applications")
        .select("status")
        .eq("chapter_id", challengeForCheckin.chapter_id as string)
        .eq("email", submitterProfile.email as string)
        .single();

      if (!checkinApp || checkinApp.status !== "checked_in") {
        return { error: "You must be checked in to submit a project." };
      }
    }
  }

  // Verify team is registered for this challenge
  const { data: registration } = await adminClient
    .from("challenge_registrations")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("team_id", teamId)
    .single();

  if (!registration) {
    return { error: "Your team is not registered for this challenge." };
  }

  // Check if submission is locked (flag set by cron)
  const { data: existing } = await adminClient
    .from("submissions")
    .select("is_locked")
    .eq("challenge_id", challengeId)
    .eq("team_id", teamId)
    .single();

  if (existing?.is_locked) {
    return { error: "Submissions are locked. The deadline has passed." };
  }

  // Also check the actual deadline (cron may not have run yet)
  const { data: challengeRow } = await adminClient
    .from("challenges")
    .select("chapter_id")
    .eq("id", challengeId)
    .single();

  if (challengeRow) {
    const { data: chapter } = await adminClient
      .from("chapters")
      .select("submission_deadline")
      .eq("id", challengeRow.chapter_id)
      .single();

    if (chapter?.submission_deadline && new Date(chapter.submission_deadline) <= new Date()) {
      return { error: "The submission deadline has passed." };
    }
  }

  // Entire session-history hard gate. When the challenge requires it, every repo
  // field must carry an Entire session record (the legacy branch or a
  // ref-based checkpoint with at least one captured prompt). The check is intentionally SOFT/tolerant
  // of imperfect checkpoints across agents and Entire versions: see lib/entire.ts.
  // Blocks the submission BEFORE persisting so a missing record never half-saves.
  {
    const { data: entireChallenge } = await adminClient
      .from("challenges")
      .select("entire_required, submission_fields")
      .eq("id", challengeId)
      .single();

    if (entireChallenge?.entire_required) {
      const repoFields = (
        (entireChallenge.submission_fields as SubmissionFieldConfig[]) ?? []
      ).filter((f) => f.type === "repo");

      for (const rf of repoFields) {
        const repoUrl = fields[rf.key];
        if (!repoUrl) continue; // required-ness of the field itself is handled elsewhere
        const parsed = parseGitHubRepo(repoUrl);
        if (!parsed) continue; // malformed URL handled by repo verification

        const check = await checkCheckpointBranch(parsed.owner, parsed.repo);
        if (!check.satisfiesGate) {
          return { error: entireGateErrorMessage(check) };
        }
      }
    }
  }

  const { error } = await adminClient.from("submissions").upsert(
    {
      challenge_id: challengeId,
      team_id: teamId,
      project_name: projectName,
      short_description: shortDescription,
      fields,
      tech_stack: techStack,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "challenge_id,team_id" }
  );

  if (error) return { error: error.message };

  logEvent({
    action: "submission.created",
    entityType: "submission",
    entityId: challengeId,
    actorId: user.id,
    actorType: "participant",
    delta: { created: { project_name: projectName } },
  });

  // Snapshot any repo fields (early copy, will be replaced at deadline)
  try {
    const { data: challenge } = await adminClient
      .from("challenges")
      .select("submission_fields, chapter_id")
      .eq("id", challengeId)
      .single();

    if (challenge?.submission_fields) {
      const submissionFields = challenge.submission_fields as SubmissionFieldConfig[];
      const repoFields = submissionFields.filter((f) => f.type === "repo");

      if (repoFields.length > 0) {
        // Get team + chapter info for naming
        const [teamResult, chapterResult] = await Promise.all([
          adminClient.from("teams").select("name").eq("id", teamId).single(),
          adminClient.from("chapters").select("slug").eq("id", challenge.chapter_id).single(),
        ]);
        const team = teamResult.data;
        const chapterData = chapterResult.data;

        for (const rf of repoFields) {
          const repoUrl = fields[rf.key];
          if (!repoUrl) continue;

          const parsed = parseGitHubRepo(repoUrl);
          if (!parsed) continue;

          const snapshotName = makeSnapshotName(
            team?.name || teamId,
            chapterData?.slug || challenge.chapter_id
          );

          const result = await snapshotRepo(
            parsed.owner,
            parsed.repo,
            snapshotName,
            `EHL submission snapshot: ${team?.name || teamId}`
          );

          if ("snapshotUrl" in result) {
            await adminClient
              .from("submissions")
              .update({ fork_url: result.snapshotUrl })
              .eq("challenge_id", challengeId)
              .eq("team_id", teamId);

            // Copy the Entire session-history branch into the private fork so the
            // record is captured under EHL control (best-effort, never blocks).
            await fetchCheckpointBranchIntoFork(parsed.owner, parsed.repo, snapshotName).catch(
              (e) => console.error("Checkpoint branch capture failed:", e)
            );
          } else {
            // Fork must always succeed: repos can change visibility at any time
            console.error("Snapshot error:", result.error);
            return {
              error: `Could not create a snapshot of your repository: ${result.error}`,
            };
          }
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Auto-snapshot failed:", msg);
    return { error: `Snapshot failed: ${msg}` };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function lockSubmissions(challengeId: string) {
  const { requireAdminAction } = await import("@/lib/admin-auth");
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  return lockSubmissionsCore(challengeId);
}
