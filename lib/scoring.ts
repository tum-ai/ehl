import type { Team, Score, Chapter, LeaderboardEntry } from "./types";

export const PLACEMENT_POINTS: Record<number, number> = {
  1: 8,
  2: 7,
  3: 6,
  4: 4,
  5: 4,
};

export const PARTICIPATION_POINTS = 2;

export function getPoints(
  placement: number | null,
  submitted: boolean
): number {
  if (!submitted) return 0;
  if (placement && PLACEMENT_POINTS[placement])
    return PLACEMENT_POINTS[placement];
  return PARTICIPATION_POINTS;
}

export function calculateLeaderboard(
  teams: Team[],
  scores: Score[],
  _chapters: Chapter[]
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = teams.map((team) => {
    const teamScores = scores.filter((s) => s.teamId === team.id);
    const totalPoints = teamScores.reduce((sum, s) => sum + s.points, 0);
    const matchesPlayed = teamScores.length;
    const placements = teamScores
      .map((s) => s.placement)
      .filter((p): p is number => p !== null);
    const bestFinish = placements.length > 0 ? Math.min(...placements) : null;

    return {
      rank: 0,
      team,
      totalPoints,
      matchesPlayed,
      bestFinish,
    };
  });

  entries.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.bestFinish === null && b.bestFinish === null) return 0;
    if (a.bestFinish === null) return 1;
    if (b.bestFinish === null) return -1;
    return a.bestFinish - b.bestFinish;
  });

  // Assign ranks with ties (same points + same bestFinish = same rank)
  let currentRank = 1;
  entries.forEach((entry, i) => {
    if (i > 0) {
      const prev = entries[i - 1];
      if (entry.totalPoints !== prev.totalPoints || entry.bestFinish !== prev.bestFinish) {
        currentRank = i + 1;
      }
    }
    entry.rank = currentRank;
  });

  return entries;
}
