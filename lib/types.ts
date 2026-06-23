export type ChapterStatus =
  | "draft"
  | "announced"
  | "applications_open"
  | "preparation"
  | "challenge_selection"
  | "hacking"
  | "submissions_open"
  | "pitching"
  | "completed";

export type PartnerTier = "challenge_partner" | "tech_partner" | "community_partner";

export type MediaType = "photo" | "video" | "aftermovie" | "short";

export type UserRole = "participant" | "jury" | "admin" | "chapter_admin";

export type CodeReviewStatus = "pending" | "queued" | "processing" | "completed" | "failed";

export type ScoreSource = "jury" | "admin_override";

// ─── Submission field config (stored as JSONB on challenges) ───

export interface SubmissionFieldConfig {
  key: string;
  label: string;
  type: "file" | "url" | "text" | "repo";
  required: boolean;
  accept?: string;
  placeholder?: string;
  repoAccess?: "public" | "invite_required" | "any";
}

// ─── Domain types ──────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  lookingForTeam: boolean;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  university: string | null;
  city: string | null;
  presidentUserId: string | null;
  lookingForMembers: boolean;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: "president" | "member";
  joinedAt: string;
  profile?: Profile;
}

export interface Chapter {
  id: string;
  name: string;
  slug: string;
  city: string;
  country: string;
  countryCode: string;
  date: string | null;
  dateEnd: string | null;
  status: ChapterStatus;
  description: string;
  heroImageUrl: string | null;
  matchNumber: number;
  isFinale: boolean;
  submissionDeadline: string | null;
  codeReviewEnabled: boolean;
  photoAlbumUrl: string | null;
  challengeRegistrationEnabled: boolean;
  applicationDeadline: string | null;
  challengeSelectionDeadline: string | null;
}

export interface Challenge {
  id: string;
  chapterId: string;
  title: string;
  description: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  prizeDescription: string | null;
  judgingCriteria: string | null;
  submissionFields: SubmissionFieldConfig[];
  codeReviewEnabled: boolean;
  isScored: boolean;
  inviteJuryToForks: boolean;
  entireRequired: boolean;
  pitchDurationMinutes: number;
  displayOrder: number;
  briefFileId: string | null;
  codeReviewInstructions: string | null;
  codeReviewConfig: CodeReviewConfig | null;
}

export interface ChapterUnlock {
  chapterId: string;
  teamId: string;
  unlockedAt: string;
  unlockedBy: string | null;
}

export interface ChallengeRegistration {
  id: string;
  chapterId: string;
  challengeId: string;
  teamId: string;
  roster: string[];
  registeredAt: string;
}

export interface Submission {
  id: string;
  challengeId: string;
  teamId: string;
  projectName: string;
  shortDescription: string | null;
  fields: Record<string, string>;
  techStack: string[];
  submittedAt: string;
  updatedAt: string;
  isLocked: boolean;
  forkUrl: string | null;
}

export interface CodeReview {
  id: string;
  submissionId: string;
  repoUrl: string | null;
  reviewContent: CodeReviewContent | null;
  modelUsed: string | null;
  generatedAt: string;
  status: CodeReviewStatus;
  repoMetadata: RepoMetadata | null;
  pipelineLog: PipelineLog | null;
  reviewVersion: number;
  costUsd: number | null;
  progress: string | null;
  sessionHistory: SessionHistoryAnalysis | null;
}

// V1 format (legacy, backward compatible)
export interface CodeReviewContentV1 {
  summary: string;
  tech_stack_detected: string[];
  scores: Record<string, { score: number; max: number; rationale: string }>;
  strengths: string[];
  weaknesses: string[];
  notable_patterns: string;
}

// V2 format (multi-agent pipeline)
export interface CodeReviewContentV2 {
  version: 2;
  executive_summary: string;
  summary: string;
  tech_stack_detected: string[];
  architecture_pattern: string;
  scores: Record<string, { score: number; max: number; weight: number; rationale: string }>;
  weighted_total: number;
  highlights: ReviewHighlight[];
  concerns: ReviewConcern[];
  would_it_run: { verdict: string; reasoning: string };
  originality: {
    boilerplate_ratio: number;
    custom_code_ratio: number;
    assessment: string;
  };
  strengths: string[];
  weaknesses: string[];
  notable_patterns: string;
  // Advisory Entire session-history analysis (process-quality bonus). Present
  // only when the challenge had entire_required on and a checkpoint branch was
  // captured. NEVER feeds placement/scoring; informational for the jury.
  session_history?: SessionHistoryAnalysis;
}

export type CodeReviewContent = CodeReviewContentV1 | CodeReviewContentV2;

// ─── Entire Session History ──────────────────────────────────

// Result of the soft, agent-agnostic presence check on the
// entire/checkpoints/v1 branch. Tolerant of imperfect checkpoints from
// different agents (Codex, Cursor, Gemini, ...) and older/newer Entire
// versions: any positive signal counts. See lib/entire.ts.
export interface CheckpointBranchCheck {
  // Whether an Entire checkpoint branch (or a known mirror/legacy ref) exists.
  branchExists: boolean;
  // Best-effort count of distinct user prompts discovered across all
  // fallbacks. >= 1 satisfies the hard gate.
  promptCount: number;
  // Number of sharded checkpoint directories found on the branch.
  checkpointCount: number;
  // The ref that actually resolved (e.g. "entire/checkpoints/v1").
  resolvedRef: string | null;
  // True when the branch exists and has at least one prompt: passes the gate.
  satisfiesGate: boolean;
  // Non-fatal notes (e.g. "counted prompts via metadata fallback",
  // "transcript present but unparseable"). Surfaced for diagnostics, never
  // used to fail the gate.
  notes: string[];
}

// Advisory process-quality analysis. Rubric mirrors the SOTA hackathon
// approach (HackerRank Orchestrate): ownership language is the strongest
// discriminator. All scores are 1-10. This is a BONUS signal only.
export interface SessionHistoryAnalysis {
  // True if a usable history was found and analyzed. When false, the rest is
  // informational (e.g. reason explains why no bonus was awarded).
  analyzed: boolean;
  reason?: string;
  // Plausibility that the history is complete and untampered (aligns with the
  // diff, no suspicious gaps/back-dating, signing status). Higher = more
  // trustworthy. This is itself a soft signal, never a hard verdict.
  completeness: {
    score: number; // 1-10
    signed: boolean; // checkpoint commits cryptographically signed
    aligns_with_diff: boolean; // history plausibly explains the submitted code
    assessment: string;
  };
  // Process-quality rubric (advisory bonus).
  process_quality: {
    ownership_language: { score: number; rationale: string }; // weight 35
    technical_specificity: { score: number; rationale: string }; // weight 25
    iteration_verification: { score: number; rationale: string }; // weight 25
    edge_case_awareness: { score: number; rationale: string }; // weight 15
  };
  // Weighted 1-10 bonus score. Advisory; jury decides how to weight it.
  bonus_score: number;
  // Tools detected from the captured sessions (Claude Code, Codex, ...).
  agents_detected: string[];
  highlights: string[];
  summary: string;
}

// ─── Code Review Config & Metadata ───────────────────────────

export interface CodeReviewConfig {
  models: {
    tech_description: string;
    code_quality: string;
    highlights_issues: string;
    originality: string;
    coordinator: string;
  };
  weights: {
    code_quality: number;
    architecture: number;
    challenge_alignment: number;
    innovation: number;
  };
  language: string;
  token_budget: number;
}

export interface RepoMetadata {
  languages: Record<string, number>;
  total_loc: number;
  file_count: number;
  commit_count: number;
  has_readme: boolean;
  has_dockerfile: boolean;
  has_tests: boolean;
  primary_language: string;
  frameworks_detected: string[];
  token_count: number;
  sampled: boolean;
}

export interface ReviewHighlight {
  description: string;
  file?: string;
  line?: number;
}

export interface ReviewConcern {
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  file?: string;
}

export interface PipelineStageLog {
  status: "completed" | "failed" | "skipped";
  duration_ms: number;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
}

export interface PipelineLog {
  stages: Record<string, PipelineStageLog>;
  total_duration_ms: number;
  total_cost_usd: number;
}

export interface PitchOrder {
  challengeId: string;
  orderList: string[];
  generatedAt: string;
  generatedBy: string | null;
}

export interface JuryAssignment {
  userId: string;
  challengeId: string;
  chapterId: string;
  status: "pending" | "voted" | "skipped";
  assignedAt: string;
}

export interface JuryRanking {
  id: string;
  challengeId: string;
  enteredBy: string;
  ranking: Record<string, string>;
  submittedAt: string;
  isFinal: boolean;
}

export interface JuryFeedback {
  challengeId: string;
  teamId: string;
  enteredBy: string;
  feedbackText: string | null;
  submittedAt: string;
}

export interface Score {
  chapterId: string;
  teamId: string;
  challengeName: string;
  challengeId: string | null;
  placement: number | null;
  points: number;
  source: ScoreSource;
}

export interface LeaderboardEntry {
  rank: number;
  team: Team;
  totalPoints: number;
  matchesPlayed: number;
  bestFinish: number | null;
}

export interface Partner {
  id: string;
  name: string;
  logoUrl: string;
  url: string;
  tier: PartnerTier;
  description: string | null;
  displayOrder: number;
  chapterId: string | null;
}

export interface MediaItem {
  id: string;
  type: MediaType;
  url: string;
  thumbnailUrl: string | null;
  chapterId: string | null;
  caption: string | null;
  featured: boolean;
}

// ─── Applications ───────────────────────────────────────────

export type ApplicationStatus = "pending" | "accepted" | "rejected" | "waitlisted" | "checked_in";

export interface ApplicationFormData {
  dateOfBirth: string;
  gender: string;
  nationality: string;
  city: string;
  country: string;
  currentlyStudying: boolean;
  university: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  graduationDate: string | null;
  hasProgrammingSkills: boolean;
  isTumaiMember: boolean;
  hackathonExperience: string;
  linkedIn: string | null;
  github: string | null;
  website: string | null;
  hasTeam: boolean;
  dietaryRestrictions: string;
  dietaryRestrictionsOther: string | null;
  tshirtCut: string;
  tshirtSize: string;
  discoverySource: string[];
  discoverySourceOther: string | null;
  additionalNotes: string | null;
}

export interface ApplicationTeamMember {
  firstName: string;
  lastName: string;
  email: string;
}

export interface Application {
  id: string;
  chapterId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: ApplicationStatus;
  formData: ApplicationFormData;
  cvUrl: string | null;
  existingTeamId: string | null;
  teamMembers: ApplicationTeamMember[];
  checkInToken: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  consentAttendance: boolean;
  consentPrivacy: boolean;
  consentNewsletter: boolean;
  consentRecruiting: boolean;
  consentMedia: boolean;
  consentIpTransfer: boolean;
  consentSponsorData: boolean;
  createdAt: string;
  updatedAt: string;
  acceptanceEmailSentAt: string | null;
  rejectionEmailSentAt: string | null;
}

// ─── Screening ─────────────────────────────────────────────

export interface ScreeningScore {
  id: string;
  applicationId: string;
  screenerId: string;
  score: number;
  notes: string | null;
  createdAt: string;
}

export interface ScreeningData {
  scores: ScreeningScore[];
  averageScore: number | null;
  previousScores: { chapterName: string; averageScore: number }[];
  noShows: number;
  pastParticipations: number;
}

// ─── Team Join Requests ────────────────────────────────────

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export interface TeamJoinRequest {
  id: string;
  teamId: string;
  userId: string;
  chapterId: string;
  status: JoinRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  // Populated via join
  userName?: string;
  userEmail?: string;
  teamName?: string;
}

// ─── Team Invites ─────────────────────────────────────────

export type TeamInviteStatus = "pending" | "accepted" | "declined" | "expired";

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  name: string | null;
  invitedBy: string;
  status: TeamInviteStatus;
  token: string;
  createdAt: string;
  expiresAt: string;
  teamName?: string;
}

// ─── TUM.ai Verification ──────────────────────────────────

export interface TumaiVerification {
  selfReported: boolean;
  verified: boolean;
  mismatch: boolean;
}

// ─── Participant Flags ─────────────────────────────────────

export interface ParticipantFlag {
  id: string;
  email: string;
  name: string | null;
  linkedinUsername: string | null;
  githubUsername: string | null;
  reason: string;
  screenshotUrl: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedReason: string | null;
}

export interface FlagMatch {
  id: string;
  reason: string;
  screenshotUrl: string | null;
  createdByName: string;
  createdAt: string;
  matchedVia: "email" | "linkedin" | "github" | "name";
}

// ─── Event Status ──────────────────────────────────────────

export interface EventStatus {
  checkedIn: boolean;
  team: { id: string; name: string; isPresident: boolean } | null;
  challengeRegistration: ChallengeRegistration | null;
  challengeRegistrationEnabled: boolean;
  pendingJoinRequests: TeamJoinRequest[];
  incomingJoinRequests: TeamJoinRequest[];
}
