import type { ChapterStatus } from "./types";

export interface StatusCheck {
  label: string;
  passed: boolean;
}

const STATUS_FLOW: ChapterStatus[] = [
  "draft",
  "announced",
  "applications_open",
  "preparation",
  "challenge_selection",
  "hacking",
  "submissions_open",
  "pitching",
  "completed",
];

/** True when targetStatus is at or beyond `gate` in the flow. */
function reaches(targetStatus: ChapterStatus, gate: ChapterStatus): boolean {
  return getTargetIndex(targetStatus) >= getTargetIndex(gate);
}

export function isBackwardTransition(
  currentStatus: ChapterStatus,
  targetStatus: ChapterStatus
): boolean {
  const currentIdx = STATUS_FLOW.indexOf(currentStatus);
  const targetIdx = STATUS_FLOW.indexOf(targetStatus);
  return targetIdx <= currentIdx;
}

export function getTargetIndex(status: ChapterStatus): number {
  return STATUS_FLOW.indexOf(status);
}

export function getNextStatus(
  currentStatus: ChapterStatus
): ChapterStatus | null {
  const idx = STATUS_FLOW.indexOf(currentStatus);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

interface ChapterFields {
  name?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  date?: string | null;
  date_end?: string | null;
  application_deadline?: string | null;
  challenge_selection_deadline?: string | null;
  submission_deadline?: string | null;
}

export interface StatusCheckCounts {
  challengeCount?: number;
  registrationCount?: number;
  submissionCount?: number;
  juryCount?: number;
  publishedScoreCount?: number;
  /** Titles of challenges with code review enabled but not fully configured. */
  unconfiguredReviewChallenges?: string[];
}

export function validateAnnouncedReady(chapter: ChapterFields): StatusCheck[] {
  return [
    { label: "Name is set", passed: !!chapter.name?.trim() },
    { label: "City is set", passed: !!chapter.city?.trim() },
    { label: "Country is set", passed: !!chapter.country?.trim() },
    { label: "Description is set", passed: !!chapter.description?.trim() },
  ];
}

export function isDateExact(date: string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date + "T00:00:00");
  return d.getDate() !== 1;
}

export function validateApplicationsOpenReady(
  chapter: ChapterFields
): StatusCheck[] {
  return [
    {
      label: "Exact start date is set (not approximate)",
      passed: isDateExact(chapter.date),
    },
    {
      label: "Application deadline is set",
      passed: !!chapter.application_deadline,
    },
  ];
}

export function validateChallengeSelectionReady(
  chapter: ChapterFields,
  challengeCount: number
): StatusCheck[] {
  return [
    { label: "Start date is set", passed: !!chapter.date },
    { label: "End date is set", passed: !!chapter.date_end },
    {
      label: "At least one challenge exists",
      passed: challengeCount > 0,
    },
    {
      label: "Challenge selection deadline is set",
      passed: !!chapter.challenge_selection_deadline,
    },
  ];
}

export function validateSubmissionsOpenReady(
  chapter: ChapterFields,
  registrationCount: number,
  unconfiguredReviewChallenges: string[] = []
): StatusCheck[] {
  const checks: StatusCheck[] = [
    {
      label: "At least one team is registered",
      passed: registrationCount > 0,
    },
    {
      label: "Submission deadline is set",
      passed: !!chapter.submission_deadline,
    },
  ];
  // Only present a code-review readiness line when review is enabled somewhere.
  if (unconfiguredReviewChallenges.length > 0) {
    checks.push({
      label: `Code review not configured for: ${unconfiguredReviewChallenges.join(", ")}`,
      passed: false,
    });
  }
  return checks;
}

export function validatePitchingReady(
  submissionCount: number,
  juryCount: number
): StatusCheck[] {
  return [
    {
      label: "At least one submission exists",
      passed: submissionCount > 0,
    },
    {
      label: "Jury is assigned to at least one challenge",
      passed: juryCount > 0,
    },
  ];
}

export function validateCompletedReady(
  publishedScoreCount: number
): StatusCheck[] {
  return [
    { label: "Scores are published", passed: publishedScoreCount > 0 },
  ];
}

/**
 * Pure flow/field logic for status-readiness checks. The DB-dependent counts
 * are gathered by the caller (lib/actions/admin.ts getStatusChecks) and passed
 * in, so this function — and its tests — match the live transition gating.
 */
export function getStatusChecksForTarget(
  currentStatus: ChapterStatus,
  targetStatus: ChapterStatus,
  chapter: ChapterFields,
  counts: StatusCheckCounts
): StatusCheck[] {
  if (isBackwardTransition(currentStatus, targetStatus)) return [];

  const checks: StatusCheck[] = [];

  if (reaches(targetStatus, "announced")) {
    checks.push(...validateAnnouncedReady(chapter));
  }

  if (reaches(targetStatus, "applications_open")) {
    checks.push(...validateApplicationsOpenReady(chapter));
  }

  // Preparation - no extra checks, just close applications

  if (reaches(targetStatus, "challenge_selection")) {
    checks.push(
      ...validateChallengeSelectionReady(chapter, counts.challengeCount ?? 0)
    );
  }

  // hacking / submissions_open both require a registered team + deadline
  if (reaches(targetStatus, "hacking")) {
    checks.push(
      ...validateSubmissionsOpenReady(
        chapter,
        counts.registrationCount ?? 0,
        counts.unconfiguredReviewChallenges ?? []
      )
    );
  }

  if (reaches(targetStatus, "pitching")) {
    checks.push(
      ...validatePitchingReady(
        counts.submissionCount ?? 0,
        counts.juryCount ?? 0
      )
    );
  }

  if (reaches(targetStatus, "completed")) {
    checks.push(...validateCompletedReady(counts.publishedScoreCount ?? 0));
  }

  return checks;
}
