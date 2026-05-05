import type { Chapter, Score, Partner, MediaItem, LeaderboardEntry } from "../types";
import { getClient } from "./client";
import { toChapter, toScore, toPartner, toMediaItem } from "./mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";

// ─── Chapter Queries ──────────────────────────────────────

export async function getChapters(): Promise<Chapter[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .order("match_number");
  return (data ?? []).map(toChapter);
}

/** Returns ALL chapters including drafts. Uses service-role key, bypasses RLS. Admin only. */
export async function getChaptersAdmin(): Promise<Chapter[]> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .order("match_number");
  return (data ?? []).map(toChapter);
}

export async function getChapterBySlug(
  slug: string
): Promise<Chapter | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("slug", slug)
    .single();
  return data ? toChapter(data) : null;
}

export async function getChapterById(
  id: string
): Promise<Chapter | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("id", id)
    .single();
  return data ? toChapter(data) : null;
}

/** Get chapter by ID including drafts. Uses service-role key, bypasses RLS. Admin only. */
export async function getChapterByIdAdmin(
  id: string
): Promise<Chapter | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("id", id)
    .single();
  return data ? toChapter(data) : null;
}

export async function getCompletedChaptersCount(): Promise<number> {
  const supabase = getClient();
  const { count } = await supabase
    .from("chapters")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");
  return count ?? 0;
}

// ─── Score Queries ────────────────────────────────────────

export async function getScores(): Promise<Score[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("scores")
    .select("*")
    .order("placement", { ascending: true, nullsFirst: false })
    .limit(QUERY_LIMITS.scores);
  return (data ?? []).map(toScore);
}

export async function getScoresForChapter(
  chapterId: string
): Promise<Score[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("scores")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("placement", { ascending: true, nullsFirst: false });
  return (data ?? []).map(toScore);
}

// ─── Leaderboard ──────────────────────────────────────────

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("leaderboard")
    .select("*")
    .order("rank")
    .limit(QUERY_LIMITS.leaderboard);

  if (!data) return [];

  return data.map((row) => ({
    rank: row.rank as number,
    team: {
      id: row.team_id as string,
      name: row.team_name as string,
      slug: row.team_slug as string,
      logoUrl: (row.logo_url as string) ?? null,
      university: (row.university as string) ?? null,
      city: (row.origin as string) ?? null,
      presidentUserId: null,
      lookingForMembers: false,
    },
    totalPoints: row.total_points as number,
    matchesPlayed: row.matches_played as number,
    bestFinish: (row.best_finish as number) ?? null,
  }));
}

// ─── Scores for Team (published only) ─────────────────────

interface TeamChapterScore {
  chapterId: string;
  chapterName: string;
  chapterSlug: string;
  placement: number | null;
  points: number;
  challengeName: string | null;
}

export async function getPublishedScoresForTeam(
  teamId: string
): Promise<TeamChapterScore[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("scores")
    .select("chapter_id, placement, points, challenge_name, chapters!inner(name, slug)")
    .eq("team_id", teamId)
    .eq("published", true);

  if (!data) return [];

  return data.map((row) => {
    const chapter = row.chapters as unknown as { name: string; slug: string };
    return {
      chapterId: row.chapter_id as string,
      chapterName: chapter.name,
      chapterSlug: chapter.slug,
      placement: row.placement as number | null,
      points: row.points as number,
      challengeName: (row.challenge_name as string) ?? null,
    };
  });
}

// ─── Partner Queries ──────────────────────────────────────

/** Returns all partner rows (including chapter-specific duplicates). */
export async function getAllPartners(): Promise<Partner[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("partners")
    .select("*")
    .order("display_order");
  return (data ?? []).map(toPartner);
}

/**
 * Returns unique partners for global display (landing page, /partners).
 * Partners assigned to multiple chapters appear only once,
 * keeping the entry with the lowest display_order.
 */
export async function getPartners(): Promise<Partner[]> {
  const all = await getAllPartners();
  return deduplicatePartners(all);
}

export async function getPartnersForChapter(
  chapterId: string
): Promise<Partner[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("partners")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("display_order");
  return (data ?? []).map(toPartner);
}

/**
 * Deduplicate partners by name, keeping the first occurrence
 * (lowest display_order since input is sorted).
 */
export function deduplicatePartners(partners: Partner[]): Partner[] {
  const seen = new Set<string>();
  return partners.filter((p) => {
    const key = p.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Media Queries ────────────────────────────────────────

export async function getMedia(): Promise<MediaItem[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("media")
    .select("*")
    .order("featured", { ascending: false })
    .limit(QUERY_LIMITS.media);
  return (data ?? []).map(toMediaItem);
}

export async function getMediaForChapter(
  chapterId: string
): Promise<MediaItem[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("media")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("featured", { ascending: false });
  return (data ?? []).map(toMediaItem);
}
