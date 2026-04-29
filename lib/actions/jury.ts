"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction } from "@/lib/admin-auth";
import { PLACEMENT_POINTS, PARTICIPATION_POINTS } from "@/lib/scoring";

export async function removeJuryMember(userId: string): Promise<{ success?: boolean; error?: string }> {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

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

  // Validate ranking: placements must be consecutive integers, teamIds must be real submissions
  const places = Object.keys(ranking).map(Number);
  const teamIds = Object.values(ranking);

  if (places.length === 0) {
    return { error: "Ranking cannot be empty." };
  }

  // Check placements are consecutive starting at 1
  const sorted = [...places].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      return { error: "Invalid placement values. Must be consecutive starting at 1." };
    }
  }

  // Check no duplicate teamIds
  if (new Set(teamIds).size !== teamIds.length) {
    return { error: "Duplicate teams in ranking." };
  }

  // Verify all teamIds are actual submissions for this challenge
  const { data: submissions } = await adminClient
    .from("submissions")
    .select("team_id")
    .eq("challenge_id", challengeId);

  const validTeamIds = new Set((submissions ?? []).map((s) => s.team_id as string));
  for (const tid of teamIds) {
    if (!validTeamIds.has(tid)) {
      return { error: "Ranking contains invalid team." };
    }
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

  // Aggregate rankings: average placement across all votes
  // Each ranking is {place: teamId}, we invert to {teamId: [places]}
  const teamPlacements: Record<string, number[]> = {};

  for (const r of rankings) {
    const rankingData = r.ranking as Record<string, string>;
    for (const [place, teamId] of Object.entries(rankingData)) {
      if (!teamPlacements[teamId]) teamPlacements[teamId] = [];
      teamPlacements[teamId].push(parseInt(place));
    }
  }

  // Calculate average placement per team, sort ascending (lower = better)
  const teamAverages = Object.entries(teamPlacements)
    .map(([teamId, places]) => ({
      teamId,
      avgPlace: places.reduce((sum, p) => sum + p, 0) / places.length,
      voteCount: places.length,
    }))
    .sort((a, b) => {
      // More votes first as tiebreaker, then lower average
      if (Math.abs(a.avgPlace - b.avgPlace) < 0.001) return b.voteCount - a.voteCount;
      return a.avgPlace - b.avgPlace;
    });

  // Only generate scores for scored challenges (challenge partner)
  // Community partner challenges are judged but don't affect league points
  if (isScored) {
    const { data: submissions } = await adminClient
      .from("submissions")
      .select("team_id")
      .eq("challenge_id", challengeId);

    // Load existing admin overrides so we don't overwrite them
    const { data: existingOverrides } = await adminClient
      .from("scores")
      .select("team_id")
      .eq("chapter_id", challenge.chapter_id as string)
      .eq("source", "admin_override");
    const overriddenTeamIds = new Set(
      (existingOverrides ?? []).map((s) => s.team_id as string)
    );

    // Build all scores in memory, then upsert as a single batch (atomic)
    const scoresToUpsert: Array<{
      chapter_id: unknown;
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
      const points = PLACEMENT_POINTS[placement] || 0;
      const teamId = teamAverages[i].teamId;
      rankedTeamIds.add(teamId);

      if (overriddenTeamIds.has(teamId)) continue;

      scoresToUpsert.push({
        chapter_id: challenge.chapter_id,
        team_id: teamId,
        challenge_id: challengeId,
        challenge_name: (challenge.title as string) || "",
        placement,
        points,
        source: "jury",
        published: false,
      });
    }

    // Participation scores for unranked submissions
    if (submissions) {
      for (const sub of submissions) {
        const teamId = sub.team_id as string;
        if (!rankedTeamIds.has(teamId) && !overriddenTeamIds.has(teamId)) {
          scoresToUpsert.push({
            chapter_id: challenge.chapter_id,
            team_id: teamId,
            challenge_id: challengeId,
            challenge_name: (challenge.title as string) || "",
            placement: null,
            points: PARTICIPATION_POINTS,
            source: "jury",
            published: false,
          });
        }
      }
    }

    // Single atomic upsert for all scores
    if (scoresToUpsert.length > 0) {
      const { error: scoreError } = await adminClient
        .from("scores")
        .upsert(scoresToUpsert, { onConflict: "chapter_id,team_id" });

      if (scoreError) {
        return { error: `Failed to save scores: ${scoreError.message}` };
      }
    }
  }

  // Get current admin user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Mark all rankings for this challenge as final
  await adminClient
    .from("jury_rankings")
    .update({ is_final: true })
    .eq("challenge_id", challengeId);

  // Mark challenge as finalized
  await adminClient
    .from("challenges")
    .update({
      jury_finalized_at: new Date().toISOString(),
      jury_finalized_by: user?.id || null,
    })
    .eq("id", challengeId);

  // Audit log
  await adminClient.from("admin_audit_log").insert({
    action: "finalize_jury_votes",
    entity_type: "challenge",
    entity_id: challengeId,
    performed_by: user?.id || null,
    details: {
      chapter_id: challenge.chapter_id,
      challenge_title: challenge.title,
      is_scored: isScored,
      rankings_count: rankings.length,
      team_results: teamAverages.slice(0, 5).map((t) => ({
        teamId: t.teamId,
        avgPlace: t.avgPlace,
        voteCount: t.voteCount,
      })),
    },
  });

  revalidatePath("/admin/jury");
  revalidatePath("/jury");
  return { success: true };
}
