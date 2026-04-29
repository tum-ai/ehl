"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckinStatusForUsers } from "@/lib/queries/checkin";
import { parseGitHubRepo, snapshotRepo, addCollaborators } from "@/lib/github";
import type { SubmissionFieldConfig } from "@/lib/types";

export async function registerForChallenge(
  chapterId: string,
  challengeId: string,
  teamId: string,
  roster: string[]
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

  if (!chapter || chapter.status !== "registration_open") {
    return { error: "Challenge selection is closed." };
  }

  // Check actual deadline (cron may not have run yet)
  if (chapter.challenge_selection_deadline && new Date(chapter.challenge_selection_deadline) <= new Date()) {
    return { error: "The challenge selection deadline has passed." };
  }

  // Verify team is unlocked for this chapter
  const { data: unlock } = await adminClient
    .from("chapter_unlocks")
    .select("chapter_id")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .single();

  if (!unlock) {
    return { error: "Your team has not been unlocked for this chapter." };
  }

  // Auto-populate roster from team members if not provided
  let finalRoster = roster;
  if (finalRoster.length === 0) {
    const { data: members } = await adminClient
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId);
    finalRoster = (members ?? []).map((m) => m.user_id as string);
  }

  // Verify all roster members are checked in for this chapter
  if (finalRoster.length > 0) {
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
  }

  // Check if already registered for this chapter
  const { data: existing } = await adminClient
    .from("challenge_registrations")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .single();

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

  revalidatePath(`/matches`);
  return { success: true, challengeId };
}

/**
 * Generate a slug-safe repo name for a snapshot.
 */
function makeSnapshotName(teamName: string, chapterSlug: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug(chapterSlug)}-${slug(teamName)}`;
}

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
  return lockSubmissionsInternal(challengeId);
}

/** Core lock logic, callable from cron without session auth. */
export async function lockSubmissionsInternal(challengeId: string) {
  const adminClient = createAdminClient();

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

    if (!challenge?.submission_fields) return { success: true };

    const submissionFields = challenge.submission_fields as SubmissionFieldConfig[];
    const repoFields = submissionFields.filter((f) => f.type === "repo");
    if (repoFields.length === 0) return { success: true };

    // Get all submissions for this challenge
    const { data: submissions } = await adminClient
      .from("submissions")
      .select("id, team_id, fields")
      .eq("challenge_id", challengeId);

    if (!submissions || submissions.length === 0) return { success: true };

    // Get chapter slug for naming
    const { data: chapterData } = await adminClient
      .from("chapters")
      .select("slug")
      .eq("id", challenge.chapter_id)
      .single();

    // Get jury emails only if invite_jury_to_forks is enabled
    const shouldInviteJury = challenge.invite_jury_to_forks === true;
    let juryEmails: string[] = [];

    if (shouldInviteJury) {
      const { data: juryAssignments } = await adminClient
        .from("jury_assignments")
        .select("user_id")
        .eq("challenge_id", challengeId);

      if (juryAssignments && juryAssignments.length > 0) {
        const juryUserIds = juryAssignments.map((ja) => ja.user_id as string);
        const { data: juryProfiles } = await adminClient
          .from("profiles")
          .select("email")
          .in("id", juryUserIds);
        juryEmails = (juryProfiles ?? [])
          .map((p) => p.email as string)
          .filter(Boolean);
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
          team?.name || sub.team_id,
          chapterData?.slug || challenge.chapter_id
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

          // Add jury members as collaborators to the snapshot
          if (shouldInviteJury && juryEmails.length > 0) {
            const snapshotParsed = parseGitHubRepo(result.snapshotUrl);
            if (snapshotParsed) {
              await addCollaborators(
                snapshotParsed.owner,
                snapshotParsed.repo,
                juryEmails
              );
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Snapshot at deadline failed:", e);
  }

  return { success: true };
}
