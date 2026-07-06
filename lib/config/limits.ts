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
  // 400: a real event produces 200-300 curated gallery photos (Paris: 223) and
  // they render as lazy-loaded w400 thumbnails, so the page stays light.
  media: envInt("LIMIT_MEDIA", 400),
  submissionsPerChallenge: envInt("LIMIT_SUBMISSIONS_PER_CHALLENGE", 200),
  submissionsAll: envInt("LIMIT_SUBMISSIONS_ALL", 1000),
  codeReviewsPerChallenge: envInt("LIMIT_CODE_REVIEWS_PER_CHALLENGE", 200),
  chapterUnlocks: envInt("LIMIT_CHAPTER_UNLOCKS", 500),
  challengeRegistrations: envInt("LIMIT_CHALLENGE_REGISTRATIONS", 500),
  // Hard cap for the showcase bulk-CV ZIP. downloadFile makes TWO Drive calls
  // per CV (metadata + media) at roughly 1s each, so 100 CVs is ~200s against
  // the route's 300s maxDuration: real headroom, not exact-budget roulette.
  showcaseCvZip: envInt("LIMIT_SHOWCASE_CV_ZIP", 100),
  // Hard cap for the showcase bulk-photo ZIP. Like the CV ZIP, downloadFile
  // makes two Drive calls per photo (~1s each); at 150 that is ~300s, matching
  // the route's maxDuration. Photos are STORE-zipped (already-compressed JPEGs)
  // one at a time, so memory stays flat. A selection larger than this is refused
  // loudly before any bytes stream (never a silently truncated album).
  showcasePhotoZip: envInt("LIMIT_SHOWCASE_PHOTO_ZIP", 150),
  usersLookingForTeam: envInt("LIMIT_USERS_LOOKING_FOR_TEAM", 500),
  codeReviewQueueDepth: envInt("LIMIT_CODE_REVIEW_QUEUE_DEPTH", 200),
  adminStatsApplications: envInt("LIMIT_ADMIN_STATS_APPLICATIONS", 10000),
  applicationNotes: envInt("LIMIT_APPLICATION_NOTES", 500),
  // Max recipients fetched per chapter broadcast send. Capped so the synchronous
  // send loop stays within the Vercel function timeout (see sendChapterBroadcast,
  // which also stops early on a wall-clock budget). Through a 3-connection SMTP
  // pool, 200 sends comfortably fit; raise only if your SMTP throughput allows.
  broadcastRecipients: envInt("LIMIT_BROADCAST_RECIPIENTS", 200),
  broadcasts: envInt("LIMIT_BROADCASTS", 50),
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

// Minimum members a team must keep after an admin removes someone. A domain
// invariant enforced on admin member removal (lib/actions/admin.ts): a removal
// that would drop the team below this is rejected, so an admin can never leave a
// team too small to compete. The president always counts toward this total.
export const MIN_TEAM_SIZE = envInt("MIN_TEAM_SIZE", 2);
