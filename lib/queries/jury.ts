import { createClient as createServerClient } from "@/lib/supabase/server";
import type { JuryAssignment, JuryRanking } from "../types";
import { toJuryAssignment, toJuryRanking } from "./mappers";

// ─── Jury Assignment Queries ──────────────────────────────

export async function getJuryAssignmentsForUser(
  userId: string
): Promise<JuryAssignment[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("jury_assignments")
    .select("*")
    .eq("user_id", userId);
  return (data ?? []).map(toJuryAssignment);
}

/**
 * Resolve the jury assignment for a user within a chapter.
 *
 * A juror can be assigned to MORE THAN ONE challenge in the same chapter, so
 * resolving by chapter alone is ambiguous and would always pick the first
 * challenge. When a specific `challengeId` is provided, match it exactly so the
 * juror sees the challenge they actually clicked; otherwise fall back to the
 * first assignment in the chapter (single-challenge case / legacy links).
 *
 * Returns null if the user has no assignment in the chapter, or if a
 * `challengeId` was requested but the user is not assigned to it (prevents
 * viewing a challenge they were not invited to).
 */
export async function resolveJuryAssignment(
  userId: string,
  chapterId: string,
  challengeId?: string | null
): Promise<JuryAssignment | null> {
  const assignments = await getJuryAssignmentsForUser(userId);
  const inChapter = assignments.filter((a) => a.chapterId === chapterId);
  if (inChapter.length === 0) return null;

  if (challengeId) {
    return inChapter.find((a) => a.challengeId === challengeId) ?? null;
  }
  return inChapter[0];
}

// ─── Jury Ranking Queries ─────────────────────────────────

export async function getMyJuryRanking(
  challengeId: string,
  userId: string
): Promise<JuryRanking | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("jury_rankings")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("entered_by", userId)
    .single();
  return data ? toJuryRanking(data) : null;
}

