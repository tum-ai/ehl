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

