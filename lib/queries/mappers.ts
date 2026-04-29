import type {
  Team,
  Chapter,
  Score,
  Partner,
  MediaItem,
  Challenge,
  TeamMember,
  Submission,
  CodeReview,
  PitchOrder,
  JuryAssignment,
  JuryRanking,
  JuryFeedback,
  Profile,
  SubmissionFieldConfig,
  Application,
  ApplicationFormData,
  ApplicationTeamMember,
  ScreeningScore,
  TeamJoinRequest,
  TeamInvite,
} from "../types";

// ─── Row → Domain mappers ──────────────────────────────────

export function toTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    logoUrl: (row.logo_url as string) ?? null,
    university: (row.university as string) ?? null,
    city: (row.city as string) ?? null,
    presidentUserId: (row.president_user_id as string) ?? null,
    lookingForMembers: (row.looking_for_members as boolean) ?? false,
  };
}

export function toChapter(row: Record<string, unknown>): Chapter {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    city: row.city as string,
    country: row.country as string,
    countryCode: row.country_code as string,
    date: (row.date as string) ?? null,
    dateEnd: (row.date_end as string) ?? null,
    status: row.status as Chapter["status"],
    description: row.description as string,
    heroImageUrl: (row.hero_image_url as string) ?? null,
    matchNumber: row.match_number as number,
    isFinale: row.is_finale as boolean,
    submissionDeadline: (row.submission_deadline as string) ?? null,
    codeReviewEnabled: (row.code_review_enabled as boolean) ?? false,
    photoAlbumUrl: (row.photo_album_url as string) ?? null,
    challengeRegistrationEnabled: (row.challenge_registration_enabled as boolean) ?? false,
    applicationDeadline: (row.application_deadline as string) ?? null,
    challengeSelectionDeadline: (row.challenge_selection_deadline as string) ?? null,
  };
}

export function toScore(row: Record<string, unknown>): Score {
  return {
    chapterId: row.chapter_id as string,
    teamId: row.team_id as string,
    challengeName: row.challenge_name as string,
    challengeId: (row.challenge_id as string) ?? null,
    placement: (row.placement as number) ?? null,
    points: row.points as number,
    source: (row.source as Score["source"]) ?? "admin_override",
  };
}

export function toPartner(row: Record<string, unknown>): Partner {
  return {
    id: row.id as string,
    name: row.name as string,
    logoUrl: row.logo_url as string,
    url: row.url as string,
    tier: row.tier as Partner["tier"],
    description: (row.description as string) ?? null,
    displayOrder: row.display_order as number,
    chapterId: (row.chapter_id as string) ?? null,
  };
}

export function toMediaItem(row: Record<string, unknown>): MediaItem {
  return {
    id: row.id as string,
    type: row.type as MediaItem["type"],
    url: row.url as string,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    chapterId: (row.chapter_id as string) ?? null,
    caption: (row.caption as string) ?? null,
    featured: row.featured as boolean,
  };
}

export function toChallenge(row: Record<string, unknown>): Challenge {
  return {
    id: row.id as string,
    chapterId: row.chapter_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    sponsorName: (row.sponsor_name as string) ?? null,
    sponsorLogoUrl: (row.sponsor_logo_url as string) ?? null,
    prizeDescription: (row.prize_description as string) ?? null,
    judgingCriteria: (row.judging_criteria as string) ?? null,
    submissionFields: (row.submission_fields as SubmissionFieldConfig[]) ?? [],
    codeReviewEnabled: (row.code_review_enabled as boolean) ?? false,
    isScored: (row.is_scored as boolean) ?? true,
    inviteJuryToForks: (row.invite_jury_to_forks as boolean) ?? false,
    pitchDurationMinutes: (row.pitch_duration_minutes as number) ?? 3,
    displayOrder: (row.display_order as number) ?? 0,
    briefFileId: (row.brief_file_id as string) ?? null,
    codeReviewInstructions: (row.code_review_instructions as string) ?? null,
    codeReviewConfig: (row.code_review_config as Challenge["codeReviewConfig"]) ?? null,
  };
}

export function toTeamMember(row: Record<string, unknown>): TeamMember {
  return {
    teamId: row.team_id as string,
    userId: row.user_id as string,
    role: row.role as TeamMember["role"],
    joinedAt: row.joined_at as string,
  };
}

export function toSubmission(row: Record<string, unknown>): Submission {
  return {
    id: row.id as string,
    challengeId: row.challenge_id as string,
    teamId: row.team_id as string,
    projectName: row.project_name as string,
    shortDescription: (row.short_description as string) ?? null,
    fields: (row.fields as Record<string, string>) ?? {},
    techStack: (row.tech_stack as string[]) ?? [],
    submittedAt: row.submitted_at as string,
    updatedAt: row.updated_at as string,
    isLocked: row.is_locked as boolean,
    forkUrl: (row.fork_url as string) ?? null,
  };
}

export function toCodeReview(row: Record<string, unknown>): CodeReview {
  return {
    id: row.id as string,
    submissionId: row.submission_id as string,
    repoUrl: (row.repo_url as string) ?? null,
    reviewContent: (row.review_content as CodeReview["reviewContent"]) ?? null,
    modelUsed: (row.model_used as string) ?? null,
    generatedAt: row.generated_at as string,
    status: row.status as CodeReview["status"],
    repoMetadata: (row.repo_metadata as CodeReview["repoMetadata"]) ?? null,
    pipelineLog: (row.pipeline_log as CodeReview["pipelineLog"]) ?? null,
    reviewVersion: (row.review_version as number) ?? 1,
    costUsd: (row.cost_usd as number) ?? null,
    progress: (row.progress as string) ?? null,
  };
}

export function toPitchOrder(row: Record<string, unknown>): PitchOrder {
  return {
    challengeId: row.challenge_id as string,
    orderList: (row.order_list as string[]) ?? [],
    generatedAt: row.generated_at as string,
    generatedBy: (row.generated_by as string) ?? null,
  };
}

export function toJuryAssignment(row: Record<string, unknown>): JuryAssignment {
  return {
    userId: row.user_id as string,
    challengeId: row.challenge_id as string,
    chapterId: row.chapter_id as string,
    status: (row.status as JuryAssignment["status"]) ?? "pending",
    assignedAt: row.assigned_at as string,
  };
}

export function toJuryRanking(row: Record<string, unknown>): JuryRanking {
  return {
    id: row.id as string,
    challengeId: row.challenge_id as string,
    enteredBy: row.entered_by as string,
    ranking: row.ranking as Record<string, string>,
    submittedAt: row.submitted_at as string,
    isFinal: row.is_final as boolean,
  };
}

export function toJuryFeedback(row: Record<string, unknown>): JuryFeedback {
  return {
    challengeId: row.challenge_id as string,
    teamId: row.team_id as string,
    enteredBy: row.entered_by as string,
    feedbackText: (row.feedback_text as string) ?? null,
    submittedAt: row.submitted_at as string,
  };
}

export function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    role: (row.role as Profile["role"]) ?? "participant",
    lookingForTeam: (row.looking_for_team as boolean) ?? false,
  };
}

export function toApplication(row: Record<string, unknown>): Application {
  return {
    id: row.id as string,
    chapterId: row.chapter_id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    status: row.status as Application["status"],
    formData: (row.form_data as ApplicationFormData) ?? ({} as ApplicationFormData),
    cvUrl: (row.cv_url as string) ?? null,
    existingTeamId: (row.existing_team_id as string) ?? null,
    teamMembers: (row.team_members as ApplicationTeamMember[]) ?? [],
    checkInToken: row.check_in_token as string,
    checkedInAt: (row.checked_in_at as string) ?? null,
    checkedInBy: (row.checked_in_by as string) ?? null,
    consentAttendance: row.consent_attendance as boolean,
    consentPrivacy: row.consent_privacy as boolean,
    consentNewsletter: (row.consent_newsletter as boolean) ?? false,
    consentRecruiting: (row.consent_recruiting as boolean) ?? false,
    consentMedia: (row.consent_media as boolean) ?? false,
    consentIpTransfer: (row.consent_ip_transfer as boolean) ?? false,
    consentSponsorData: (row.consent_sponsor_data as boolean) ?? false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    acceptanceEmailSentAt: (row.acceptance_email_sent_at as string) ?? null,
    rejectionEmailSentAt: (row.rejection_email_sent_at as string) ?? null,
  };
}

export function toScreeningScore(row: Record<string, unknown>): ScreeningScore {
  return {
    id: row.id as string,
    applicationId: row.application_id as string,
    screenerId: row.screener_id as string,
    score: row.score as number,
    notes: (row.notes as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function toJoinRequest(row: Record<string, unknown>): TeamJoinRequest {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    userId: row.user_id as string,
    chapterId: row.chapter_id as string,
    status: row.status as TeamJoinRequest["status"],
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string) ?? null,
    resolvedBy: (row.resolved_by as string) ?? null,
  };
}

export function toTeamInvite(row: Record<string, unknown>): TeamInvite {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    email: row.email as string,
    name: (row.name as string) ?? null,
    invitedBy: row.invited_by as string,
    status: row.status as TeamInvite["status"],
    token: row.token as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}
