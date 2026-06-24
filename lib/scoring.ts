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

/**
 * Decides what the admin scores page should tell the operator before they
 * publish, by reconciling the TWO reads that page performs:
 *
 *  1. `scoredTeamIds` — teams that have a row in the persisted `scores` table.
 *     This is the ONLY thing `publishScores` flips to `published`, and the only
 *     thing the public leaderboard view reads. It is what actually gets published.
 *
 *  2. `pendingJuryTeamIds` — teams whose jury results are DISPLAYED on the page
 *     (live aggregation from `jury_rankings`) and are EXPECTED to become scores
 *     but have not been materialized yet (their scored challenge is not finalized).
 *     The caller is responsible for excluding non-scored/community challenges and
 *     already-finalized ones, which legitimately yield no further scores.
 *
 * The historical bug: the gate looked only at read #1 (`scores.length === 0`) and
 * warned "no scores", even while read #2 visibly displayed jury results on the
 * same page. Those displayed results were never materialized into `scores`, so
 * publishing surfaced nothing publicly. This reconciles the two so the warning
 * reflects reality: "ready" (publishable scores, no pending jury), "unfinalized"
 * (displayed jury results not yet finalized — they would vanish on publish), or
 * "empty" (genuinely nothing to publish).
 */
export type PublishReadiness =
  | { kind: "ready"; scoredCount: number }
  | { kind: "unfinalized"; pendingTeamCount: number; scoredCount: number }
  | { kind: "empty" };

export function getPublishReadiness(
  scoredTeamIds: Iterable<string>,
  pendingJuryTeamIds: Iterable<string>
): PublishReadiness {
  const scored = new Set(scoredTeamIds);
  const pendingDisplayed = new Set(pendingJuryTeamIds);

  // Teams whose jury results are visible but have NOT been finalized into the
  // `scores` table. These would silently vanish on publish.
  const pending = [...pendingDisplayed].filter((teamId) => !scored.has(teamId));

  if (pending.length > 0) {
    return {
      kind: "unfinalized",
      pendingTeamCount: pending.length,
      scoredCount: scored.size,
    };
  }

  if (scored.size === 0) {
    return { kind: "empty" };
  }

  return { kind: "ready", scoredCount: scored.size };
}

/**
 * Computes the set of "pending" jury team IDs to feed `getPublishReadiness` from
 * the admin scores page's per-challenge data. A team is pending only if its jury
 * results are DISPLAYED but expected to become scores and have not yet been
 * materialized. That means it belongs to a challenge that:
 *   - is_scored (community/non-scored challenges never yield league scores), AND
 *   - is NOT yet finalized (finalized scored challenges already wrote their
 *     scores, including participation rows for unranked submitters).
 *
 * `juryAggregatedByChallenge` mirrors the jury-rankings API shape: challengeId ->
 * { teamId -> points }.
 */
export function getPendingJuryTeamIds(
  challenges: ReadonlyArray<{ id: string; isScored: boolean; juryFinalizedAt: string | null }>,
  juryAggregatedByChallenge: Record<string, Record<string, number>>
): string[] {
  const ids = new Set<string>();
  for (const challenge of challenges) {
    if (!challenge.isScored || challenge.juryFinalizedAt) continue;
    const aggregated = juryAggregatedByChallenge[challenge.id];
    if (!aggregated) continue;
    for (const teamId of Object.keys(aggregated)) ids.add(teamId);
  }
  return [...ids];
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
