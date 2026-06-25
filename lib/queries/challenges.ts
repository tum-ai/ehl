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

/**
 * All challenge registrations across every chapter, for the admin submissions
 * view (to surface teams that registered but never submitted). Uses the
 * authenticated server client so RLS applies (global admins see all). Capped by
 * QUERY_LIMITS.challengeRegistrations.
 */
export async function getAllChallengeRegistrations(): Promise<{
  registrations: ChallengeRegistration[];
  limit: number;
  limited: boolean;
}> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const limit = QUERY_LIMITS.challengeRegistrations;
  const { data } = await supabase
    .from("challenge_registrations")
    .select("*")
    .limit(limit);
  const registrations = (data ?? []).map((row) => ({
    id: row.id as string,
    chapterId: row.chapter_id as string,
    challengeId: row.challenge_id as string,
    teamId: row.team_id as string,
    roster: (row.roster as string[]) ?? [],
    registeredAt: row.registered_at as string,
  }));
  return { registrations, limit, limited: registrations.length >= limit };
}

/**
 * Team→challenge registrations for a single chapter, as a teamId→challengeId
 * map, for the admin teams view (so each team row can show and override its
 * current challenge). Authenticated server client so RLS applies (global admin).
 */
export async function getChapterRegistrationsByTeam(
  chapterId: string
): Promise<Map<string, string>> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("challenge_registrations")
    .select("team_id, challenge_id")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.challengeRegistrations);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.team_id as string, row.challenge_id as string);
  }
  return map;
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
