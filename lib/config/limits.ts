/**
 * Query limits to prevent unbounded data fetching.
 * All values have sensible defaults well above Season 1 maximums.
 *
 * Override any limit via environment variable:
 *   LIMIT_TEAMS=1000
 *   LIMIT_ALL_TEAM_MEMBERS=5000
 *   etc.
 *
 * Set in Vercel Dashboard > Settings > Environment Variables.
 * Changes take effect on next function invocation (no redeploy needed).
 */

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const QUERY_LIMITS = {
  teams: envInt("LIMIT_TEAMS", 500),
  allTeamMembers: envInt("LIMIT_ALL_TEAM_MEMBERS", 2500),
  profiles: envInt("LIMIT_PROFILES", 1000),
  applicationsPerChapter: envInt("LIMIT_APPLICATIONS_PER_CHAPTER", 2000),
  applicationStats: envInt("LIMIT_APPLICATION_STATS", 5000),
  screeningScores: envInt("LIMIT_SCREENING_SCORES", 5000),
  scores: envInt("LIMIT_SCORES", 1000),
  leaderboard: envInt("LIMIT_LEADERBOARD", 500),
  media: envInt("LIMIT_MEDIA", 200),
  submissionsPerChallenge: envInt("LIMIT_SUBMISSIONS_PER_CHALLENGE", 200),
  submissionsAll: envInt("LIMIT_SUBMISSIONS_ALL", 1000),
  codeReviewsPerChallenge: envInt("LIMIT_CODE_REVIEWS_PER_CHALLENGE", 200),
  chapterUnlocks: envInt("LIMIT_CHAPTER_UNLOCKS", 500),
  challengeRegistrations: envInt("LIMIT_CHALLENGE_REGISTRATIONS", 500),
  usersLookingForTeam: envInt("LIMIT_USERS_LOOKING_FOR_TEAM", 500),
  codeReviewQueueDepth: envInt("LIMIT_CODE_REVIEW_QUEUE_DEPTH", 200),
  adminStatsApplications: envInt("LIMIT_ADMIN_STATS_APPLICATIONS", 10000),
  applicationNotes: envInt("LIMIT_APPLICATION_NOTES", 500),
};

export type QueryLimitKey = keyof typeof QUERY_LIMITS;

// Maximum members allowed on a team. A domain invariant (not a query cap):
// enforced on registration, invites, joins, and admin overrides. Historically
// hardcoded as `5` in lib/actions/teams.ts; centralized here so admin overrides
// and team flows share one source of truth.
export const MAX_TEAM_SIZE = envInt("MAX_TEAM_SIZE", 5);

// Minimum members required on a challenge registration roster. A domain
// invariant enforced at registration time (lib/actions/event.ts); also used when
// cancelling an attendee, to drop a registration that would fall below it.
export const MIN_CHALLENGE_ROSTER = envInt("MIN_CHALLENGE_ROSTER", 2);
