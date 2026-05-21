import type { Challenge, ChallengeRegistration, PitchOrder } from "../types";
import { getClient } from "./client";
import { toChallenge, toPitchOrder } from "./mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";

// ─── Challenge Queries ────────────────────────────────────

export async function getChallengesForChapter(
  chapterId: string
): Promise<Challenge[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("challenges")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("display_order");
  return (data ?? []).map(toChallenge);
}

export async function getChallengeById(
  id: string
): Promise<Challenge | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("challenges")
    .select("*")
    .eq("id", id)
    .single();
  return data ? toChallenge(data) : null;
}

// ─── Challenge Registration Queries ───────────────────────

export async function getRegistrationForTeam(
  chapterId: string,
  teamId: string
): Promise<ChallengeRegistration | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("challenge_registrations")
    .select("*")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .single();
  if (!data) return null;
  return {
    id: data.id as string,
    chapterId: data.chapter_id as string,
    challengeId: data.challenge_id as string,
    teamId: data.team_id as string,
    roster: (data.roster as string[]) ?? [],
    registeredAt: data.registered_at as string,
  };
}

// ─── Pitch Order Queries ──────────────────────────────────

export async function getPitchOrder(
  challengeId: string
): Promise<PitchOrder | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("pitch_orders")
    .select("*")
    .eq("challenge_id", challengeId)
    .single();
  return data ? toPitchOrder(data) : null;
}
