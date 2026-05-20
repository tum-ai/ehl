// Re-export everything so existing `import { ... } from "@/lib/queries"` imports keep working.
// New code should import from the specific domain module instead.

export {
  toTeam,
  toChapter,
  toScore,
  toPartner,
  toMediaItem,
  toChallenge,
  toTeamMember,
  toSubmission,
  toCodeReview,
  toPitchOrder,
  toJuryAssignment,
  toJuryRanking,
  toJuryFeedback,
  toProfile,
  toApplication,
  toScreeningScore,
  toJoinRequest,
  toTeamInvite,
} from "./mappers";

export {
  getTeams,
  getTeamBySlug,
  getTeamForUser,
  searchTeams,
  getTeamMembers,
  getTeamMembersWithProfiles,
  getAllTeamMembers,
  getTeamsLookingForMembers,
  getPendingInvitesForTeam,
  getDashboardJoinRequestsForTeam,
  getPendingJoinRequestsForUser,
  getUsersLookingForTeam,
  getTeamMatchHistory,
} from "./teams";
export type { TeamLookingForMembers, TeamMatchHistoryEntry } from "./teams";

export {
  getChapters,
  getChaptersAdmin,
  getChapterBySlug,
  getChapterById,
  getChapterByIdAdmin,
  getCompletedChaptersCount,
  getScores,
  getScoresForChapter,
  getLeaderboard,
  getAllPartners,
  getPartners,
  getPartnersForChapter,
  deduplicatePartners,
  getMedia,
  getMediaForChapter,
  getPublishedScoresForTeam,
} from "./chapters";

export {
  getChallengesForChapter,
  getChallengeById,
  getChapterUnlocks,
  getUnlocksForTeam,
  getRegistrationForTeam,
  getPitchOrder,
} from "./challenges";

export {
  getSubmissionsForChallenge,
  getSubmissionsForChallengeAuthenticated,
  getSubmissionById,
  getSubmissionForTeam,
  getCodeReviewForSubmission,
  getCodeReviewForSubmissionAuthenticated,
} from "./submissions";

export {
  getJuryAssignmentsForUser,
  getMyJuryRanking,
} from "./jury";

export {
  getProfile,
} from "./profiles";

export {
  getCheckinStatusForUsers,
} from "./checkin";

export {
  getSeasonStats,
  getChapterDetailStats,
} from "./admin-stats";
export type {
  SeasonStats,
  ChapterStats,
  ChapterDetailStats,
} from "./admin-stats";

