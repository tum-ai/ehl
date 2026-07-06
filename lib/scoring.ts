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

  // Any team here belongs to a scored challenge that is NOT yet finalized into
  // the `scores` table (getPendingJuryTeamIds already filters to isScored &&
  // !juryFinalizedAt challenges). Such results would silently vanish on publish,
  // so we must NOT subtract teams that happen to have a score row: `scores` is
  // keyed (chapter_id, team_id), so a finalized score for the team in ANOTHER
  // challenge does not materialize THIS challenge's pending results. Treating a
  // team as resolved because it has any score row was a false-negative that
  // could report "ready" while a whole challenge's results were dropped.
  const pending = [...pendingDisplayed];

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

/**
 * Challenges that were JUDGED (have aggregated jury results) but are NOT scored,
 * so they produce no league points by design. Surfacing these stops the scores
 * page from showing a bare, misleading "No scores yet" when in fact the jury
 * ranked teams in a community challenge. If such a challenge SHOULD count, the
 * admin must mark it Scored on the Challenges page.
 */
export function getJudgedUnscoredChallenges(
  challenges: ReadonlyArray<{ id: string; title?: string; isScored: boolean }>,
  juryAggregatedByChallenge: Record<string, Record<string, number>>
): Array<{ id: string; title?: string }> {
  return challenges
    .filter((c) => {
      if (c.isScored) return false;
      const agg = juryAggregatedByChallenge[c.id];
      return !!agg && Object.keys(agg).length > 0;
    })
    .map((c) => ({ id: c.id, title: c.title }));
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

// ─── Duplicate-placement detection (manual score entry) ──────
//
// After applying pending override edits on the admin scores page, would two
// teams IN THE SAME CHALLENGE share a placement? Placements are per challenge,
// so cross-challenge repeats (two 1st places in two challenges) are fine.
// Legitimate ties exist, so callers WARN on this instead of blocking — but a
// silent double-1st within one challenge (the classic manual-entry slip) must
// never go unnoticed. Pure so the scores page's confirm logic is unit-testable.
export function findDuplicatePlacements(
  rows: Array<{ teamId: string; placement: number | null; challengeId: string | null }>
): Array<{ challengeId: string | null; placement: number; teamIds: string[] }> {
  const seen = new Map<string, { challengeId: string | null; placement: number; teamIds: string[] }>();
  for (const row of rows) {
    if (row.placement === null) continue;
    const key = `${row.challengeId ?? "none"}:${row.placement}`;
    const entry = seen.get(key) ?? {
      challengeId: row.challengeId,
      placement: row.placement,
      teamIds: [],
    };
    entry.teamIds.push(row.teamId);
    seen.set(key, entry);
  }
  return [...seen.values()].filter((e) => e.teamIds.length > 1);
}
