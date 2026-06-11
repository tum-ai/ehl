// Pure validation for a jury ranking. Lives outside the "use server" module
// so it can be exported and unit-tested directly (the logic that actually
// guards submitJuryRanking, not a re-implementation).

export type JuryRanking = Record<string, string>; // { "1": teamId, "2": teamId, ... }

/**
 * Validate a jury ranking against the set of teams that actually submitted.
 * Returns null when valid, or an error message string when invalid.
 *
 * Rules: non-empty; placements are consecutive integers starting at 1; no
 * duplicate teams; every ranked team is a real submission for the challenge.
 */
export function validateJuryRanking(
  ranking: JuryRanking,
  validTeamIds: Set<string>
): string | null {
  const places = Object.keys(ranking).map(Number);
  const teamIds = Object.values(ranking);

  if (places.length === 0) {
    return "Ranking cannot be empty.";
  }

  const sorted = [...places].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      return "Invalid placement values. Must be consecutive starting at 1.";
    }
  }

  if (new Set(teamIds).size !== teamIds.length) {
    return "Duplicate teams in ranking.";
  }

  for (const tid of teamIds) {
    if (!validTeamIds.has(tid)) {
      return "Ranking contains invalid team.";
    }
  }

  return null;
}
