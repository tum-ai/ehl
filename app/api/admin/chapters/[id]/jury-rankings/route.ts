import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id: chapterId } = await params;
  const adminClient = createAdminClient();

  // Get all challenges for this chapter
  const { data: challenges } = await adminClient
    .from("challenges")
    .select("id, title")
    .eq("chapter_id", chapterId);

  if (!challenges || challenges.length === 0) {
    return NextResponse.json({});
  }

  const challengeIds = challenges.map((c) => c.id);

  // Get all jury rankings for these challenges
  const { data: rankings } = await adminClient
    .from("jury_rankings")
    .select("id, challenge_id, entered_by, ranking, submitted_at, is_final")
    .in("challenge_id", challengeIds);

  if (!rankings || rankings.length === 0) {
    return NextResponse.json({});
  }

  // Get juror profile names
  const jurorIds = [...new Set(rankings.map((r) => r.entered_by))];
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, name")
    .in("id", jurorIds);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.name as string])
  );

  // Group by challenge, aggregate rankings
  const result: Record<string, {
    rankings: { jurorId: string; jurorName: string; ranking: Record<string, string>; submittedAt: string; isFinal: boolean }[];
    aggregated: Record<string, number>; // teamId -> total points
  }> = {};

  for (const challengeId of challengeIds) {
    const challengeRankings = rankings.filter((r) => r.challenge_id === challengeId);
    if (challengeRankings.length === 0) continue;

    // Aggregate: sum placement points across all jury members
    const teamPoints: Record<string, number> = {};

    const formattedRankings = challengeRankings.map((r) => {
      const rankingObj = r.ranking as Record<string, string>;

      // Accumulate points
      for (const [place, teamId] of Object.entries(rankingObj)) {
        const placeNum = parseInt(place);
        // Use same point values: 1st=8, 2nd=7, 3rd=6, 4th/5th=4
        const points = placeNum <= 3 ? 9 - placeNum : placeNum <= 5 ? 4 : 2;
        teamPoints[teamId] = (teamPoints[teamId] ?? 0) + points;
      }

      return {
        jurorId: r.entered_by as string,
        jurorName: profileMap.get(r.entered_by as string) ?? "Unknown",
        ranking: rankingObj,
        submittedAt: r.submitted_at as string,
        isFinal: r.is_final as boolean,
      };
    });

    result[challengeId] = {
      rankings: formattedRankings,
      aggregated: teamPoints,
    };
  }

  return NextResponse.json(result);
}
