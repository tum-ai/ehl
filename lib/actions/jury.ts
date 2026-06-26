"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction, getActingUserId } from "@/lib/admin-auth";
import { PLACEMENT_POINTS, PARTICIPATION_POINTS } from "@/lib/scoring";
import { logEvent, logEventStrict } from "@/lib/event-log";
import { validateJuryRanking } from "@/lib/jury-validation";

// ─── Score generation helpers (shared by finalize + regenerate) ─────────────
// Not exported: a "use server" module may only export async functions, and these
// are internal building blocks reused by finalizeJuryVotes and
// regenerateScoresFromFinalizedRankings so both produce identical scores.

type RankingRow = { ranking: unknown };
type AdminClient = ReturnType<typeof createAdminClient>;

/** Average each team's placement across all jury rankings, best (lowest) first. */
function aggregateTeamAverages(
  rankings: RankingRow[]
): Array<{ teamId: string; avgPlace: number; voteCount: number }> {
  const teamPlacements: Record<string, number[]> = {};
  for (const r of rankings) {
    const rankingData = (r.ranking as Record<string, string>) ?? {};
    for (const [place, teamId] of Object.entries(rankingData)) {
      if (!teamPlacements[teamId]) teamPlacements[teamId] = [];
      teamPlacements[teamId].push(parseInt(place));
    }
  }
  return Object.entries(teamPlacements)
    .map(([teamId, places]) => ({
      teamId,
      avgPlace: places.reduce((sum, p) => sum + p, 0) / places.length,
      voteCount: places.length,
    }))
    .sort((a, b) => {
      if (Math.abs(a.avgPlace - b.avgPlace) < 0.001) return b.voteCount - a.voteCount;
      return a.avgPlace - b.avgPlace;
    });
}

/**
 * Build placement (top 5) + participation scores from jury rankings and upsert
 * them. Preserves existing admin_override rows. Returns the count written, or an
 * error string. Idempotent-ish: an upsert keyed (chapter_id, team_id).
 */
async function writeScoresFromRankings(
  adminClient: AdminClient,
  challengeId: string,
  chapterId: string,
  challengeName: string,
  rankings: RankingRow[]
): Promise<{ scoresWritten: number } | { error: string }> {
  const teamAverages = aggregateTeamAverages(rankings);

  const { data: submissions } = await adminClient
    .from("submissions")
    .select("team_id")
    .eq("challenge_id", challengeId);

  // Don't overwrite admin overrides.
  const { data: existingOverrides } = await adminClient
    .from("scores")
    .select("team_id")
    .eq("chapter_id", chapterId)
    .eq("source", "admin_override");
  const overriddenTeamIds = new Set(
    (existingOverrides ?? []).map((s) => s.team_id as string)
  );

  const scoresToUpsert: Array<{
    chapter_id: string;
    team_id: string;
    challenge_id: string;
    challenge_name: string;
    placement: number | null;
    points: number;
    source: string;
    published: boolean;
  }> = [];
  const rankedTeamIds = new Set<string>();

  for (let i = 0; i < Math.min(5, teamAverages.length); i++) {
    const placement = i + 1;
    const teamId = teamAverages[i].teamId;
    rankedTeamIds.add(teamId);
    if (overriddenTeamIds.has(teamId)) continue;
    scoresToUpsert.push({
      chapter_id: chapterId,
      team_id: teamId,
      challenge_id: challengeId,
      challenge_name: challengeName,
      placement,
      points: PLACEMENT_POINTS[placement] || 0,
      source: "jury",
      published: false,
    });
  }

  for (const sub of submissions ?? []) {
    const teamId = sub.team_id as string;
    if (!rankedTeamIds.has(teamId) && !overriddenTeamIds.has(teamId)) {
      scoresToUpsert.push({
        chapter_id: chapterId,
        team_id: teamId,
        challenge_id: challengeId,
        challenge_name: challengeName,
        placement: null,
        points: PARTICIPATION_POINTS,
        source: "jury",
        published: false,
      });
    }
  }

  if (scoresToUpsert.length > 0) {
    const { error } = await adminClient
      .from("scores")
      .upsert(scoresToUpsert, { onConflict: "chapter_id,team_id" });
    if (error) return { error: `Failed to save scores: ${error.message}` };
  }

  return { scoresWritten: scoresToUpsert.length };
}

export async function removeJuryMember(userId: string): Promise<{ success?: boolean; error?: string }> {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const adminUserId = await getActingUserId();
  if (!adminUserId) return { error: "Could not identify admin user." };

  // Remove all assignments first
  await adminClient
    .from("jury_assignments")
    .delete()
    .eq("user_id", userId);

  // Remove rankings
  await adminClient
    .from("jury_rankings")
    .delete()
    .eq("entered_by", userId);

  // Remove profile
  await adminClient
    .from("profiles")
    .delete()
    .eq("id", userId)
    .eq("role", "jury");

  // Remove auth user
  await adminClient.auth.admin.deleteUser(userId);

  logEvent({
    action: "jury.member_removed",
    entityType: "jury",
    entityId: userId,
    actorId: adminUserId,
    actorType: "admin",
    delta: { deleted: { user_id: userId } },
  });

  revalidatePath("/admin/jury");
  return { success: true };
}

export async function removeJuryAssignment(userId: string, challengeId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("jury_assignments")
    .delete()
    .eq("user_id", userId)
    .eq("challenge_id", challengeId);

  if (error) return { error: error.message };
  revalidatePath("/admin/jury");
  return { success: true };
}

export async function submitJuryRanking(formData: FormData) {
  const challengeId = formData.get("challengeId") as string;
  const rankingJson = formData.get("ranking") as string;
  const feedbackJson = formData.get("feedback") as string;

  if (!challengeId || !rankingJson) {
    return { error: "Challenge and ranking are required." };
  }

  let ranking: Record<string, string>;
  let feedback: Record<string, string>;

  try {
    ranking = JSON.parse(rankingJson);
    feedback = feedbackJson ? JSON.parse(feedbackJson) : {};
  } catch {
    return { error: "Invalid data format." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Check if user is assigned to this challenge and hasn't already voted
  const { data: assignment } = await adminClient
    .from("jury_assignments")
    .select("user_id, status")
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId)
    .single();

  if (!assignment) {
    return { error: "You are not assigned to this challenge." };
  }

  if (assignment.status === "voted") {
    return { error: "You have already submitted your vote for this challenge." };
  }

  // Check if challenge is already finalized
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("jury_finalized_at")
    .eq("id", challengeId)
    .single();

  if (challenge?.jury_finalized_at) {
    return { error: "Voting for this challenge has been finalized." };
  }

  // Verify all teamIds are actual submissions for this challenge
  const { data: submissions } = await adminClient
    .from("submissions")
    .select("team_id")
    .eq("challenge_id", challengeId);

  const validTeamIds = new Set((submissions ?? []).map((s) => s.team_id as string));

  // Validate ranking shape (consecutive placements, no dupes, real teams)
  const validationError = validateJuryRanking(ranking, validTeamIds);
  if (validationError) {
    return { error: validationError };
  }

  // Insert ranking (one vote per juror per challenge, no re-voting)
  const { error: rankError } = await adminClient.from("jury_rankings").insert({
    challenge_id: challengeId,
    entered_by: user.id,
    ranking,
    is_final: false,
  });

  if (rankError) return { error: rankError.message };

  // Insert feedback per team per juror
  for (const [teamId, text] of Object.entries(feedback)) {
    if (text.trim()) {
      const feedbackText = text.trim().slice(0, 5000);
      const { error: fbError } = await adminClient.from("jury_feedback").upsert(
        {
          challenge_id: challengeId,
          team_id: teamId,
          entered_by: user.id,
          feedback_text: feedbackText,
        },
        { onConflict: "challenge_id,team_id,entered_by" }
      );
      if (fbError) {
        console.error(`Failed to save feedback for team ${teamId}:`, fbError.message);
      }
    }
  }

  // Mark assignment as voted
  await adminClient
    .from("jury_assignments")
    .update({ status: "voted" })
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId);

  await logEventStrict({
    action: "jury.ranking_submitted",
    entityType: "jury_ranking",
    entityId: challengeId,
    actorId: user.id,
    actorType: "jury",
    delta: { created: { team_count: Object.keys(ranking).length } },
  });

  revalidatePath("/jury");
  return { success: true };
}

export async function skipJuryVote(challengeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Check if user is assigned and hasn't already voted
  const { data: assignment } = await adminClient
    .from("jury_assignments")
    .select("user_id, status")
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId)
    .single();

  if (!assignment) {
    return { error: "You are not assigned to this challenge." };
  }

  if (assignment.status === "voted") {
    return { error: "You have already submitted your vote for this challenge." };
  }

  // Check if challenge is already finalized
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("jury_finalized_at")
    .eq("id", challengeId)
    .single();

  if (challenge?.jury_finalized_at) {
    return { error: "Voting for this challenge has been finalized." };
  }

  await adminClient
    .from("jury_assignments")
    .update({ status: "skipped" })
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId);

  revalidatePath("/jury");
  return { success: true };
}

export async function finalizeJuryVotes(challengeId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  // Resolve the acting admin BEFORE any score/finalization write, so a missing
  // actor aborts the action instead of throwing from logEventStrict after the
  // mutations have already landed.
  const adminUserId = await getActingUserId();
  if (!adminUserId) return { error: "Could not identify admin user." };
  const adminClient = createAdminClient();

  // Get all individual rankings for this challenge
  const { data: rankings } = await adminClient
    .from("jury_rankings")
    .select("ranking")
    .eq("challenge_id", challengeId);

  if (!rankings || rankings.length === 0) {
    return { error: "No votes have been submitted for this challenge." };
  }

  // Get challenge info
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("chapter_id, title, is_scored, jury_finalized_at")
    .eq("id", challengeId)
    .single();

  if (!challenge) return { error: "Challenge not found." };

  // Prevent double-finalization
  if (challenge.jury_finalized_at) {
    return { error: "This challenge has already been finalized." };
  }

  const isScored = challenge.is_scored as boolean;

  const teamAverages = aggregateTeamAverages(rankings);

  // Only generate scores for scored challenges (challenge partner). Community
  // partner challenges are judged but don't affect league points (and the
  // caller is told scoresWritten=0 so it never implies otherwise).
  let scoresWrittenCount = 0;
  if (isScored) {
    const written = await writeScoresFromRankings(
      adminClient,
      challengeId,
      challenge.chapter_id as string,
      (challenge.title as string) || "",
      rankings
    );
    if ("error" in written) return { error: written.error };
    scoresWrittenCount = written.scoresWritten;
  }

  // Mark all rankings for this challenge as final
  await adminClient
    .from("jury_rankings")
    .update({ is_final: true })
    .eq("challenge_id", challengeId);

  // Mark challenge as finalized (acting admin resolved at the top)
  await adminClient
    .from("challenges")
    .update({
      jury_finalized_at: new Date().toISOString(),
      jury_finalized_by: adminUserId,
    })
    .eq("id", challengeId);

  await logEventStrict({
    action: "jury.votes_finalized",
    entityType: "challenge",
    entityId: challengeId,
    actorId: adminUserId,
    actorType: "admin",
    delta: { created: { rankings_count: rankings.length, is_scored: isScored } },
  });

  revalidatePath("/admin/jury");
  revalidatePath("/jury");
  // Return what ACTUALLY happened so the UI never presents a silent no-op. An
  // unscored (community) challenge is finalized but produces NO league scores by
  // design; the caller must say so instead of implying scores were generated.
  return {
    success: true,
    isScored,
    scoresWritten: isScored ? scoresWrittenCount : 0,
    rankedTeamCount: Math.min(5, teamAverages.length),
  };
}

/**
 * Recovery path for a challenge that was finalized while it was (accidentally)
 * unscored, then corrected to Scored. finalizeJuryVotes refuses to run twice
 * (jury_finalized_at is set), so without this the admin is stuck: the challenge
 * is Scored and finalized but has no score rows, and there is no way to generate
 * them. This generates scores from the ALREADY-FINALIZED jury rankings without
 * touching jury_finalized_at (an audit fact). Preconditions are strict.
 */
export async function regenerateScoresFromFinalizedRankings(challengeId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminUserId = await getActingUserId();
  if (!adminUserId) return { error: "Could not identify admin user." };
  const adminClient = createAdminClient();

  const { data: challenge } = await adminClient
    .from("challenges")
    .select("chapter_id, title, is_scored, jury_finalized_at")
    .eq("id", challengeId)
    .single();
  if (!challenge) return { error: "Challenge not found." };

  if (!challenge.is_scored) {
    return {
      error:
        "This challenge is not marked as Scored. Mark it Scored on the Challenges page first, then generate scores.",
    };
  }
  if (!challenge.jury_finalized_at) {
    return {
      error:
        "This challenge has not been finalized yet. Use Finalize on the Jury page instead.",
    };
  }

  // Do not clobber finalized scores: only generate when none exist yet for this
  // challenge (admin_override rows are preserved regardless).
  const { data: existing } = await adminClient
    .from("scores")
    .select("team_id")
    .eq("chapter_id", challenge.chapter_id as string)
    .eq("challenge_id", challengeId)
    .eq("source", "jury");
  if (existing && existing.length > 0) {
    return {
      error: `Scores already exist for this challenge (${existing.length}). Use Score Overrides to adjust them.`,
    };
  }

  const { data: rankings } = await adminClient
    .from("jury_rankings")
    .select("ranking")
    .eq("challenge_id", challengeId);
  if (!rankings || rankings.length === 0) {
    return { error: "No finalized jury rankings exist for this challenge." };
  }

  const written = await writeScoresFromRankings(
    adminClient,
    challengeId,
    challenge.chapter_id as string,
    (challenge.title as string) || "",
    rankings
  );
  if ("error" in written) return { error: written.error };
  const scoresWritten = written.scoresWritten;

  await logEventStrict({
    action: "jury.scores_regenerated",
    entityType: "challenge",
    entityId: challengeId,
    actorId: adminUserId,
    actorType: "admin",
    delta: { created: { scores_written: scoresWritten } },
  });

  revalidatePath("/admin/jury");
  revalidatePath("/jury");
  return { success: true, scoresWritten };
}
