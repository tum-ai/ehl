import type { ChapterStatus } from "./types";

export interface StatusCheck {
  label: string;
  passed: boolean;
}

const STATUS_FLOW: ChapterStatus[] = [
  "draft",           // 0
  "announced",       // 1
  "applications_open", // 2
  "preparation",       // 3
  "challenge_selection", // 4
  "submissions_open",  // 5
  "pitching",        // 6
  "completed",       // 7
];

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
      label: "Exact date is set (not just month)",
      passed: isDateExact(chapter.date),
    },
  ];
}

export function validateRegistrationOpenReady(
  chapter: ChapterFields,
  challengeCount: number
): StatusCheck[] {
  return [
    { label: "Exact start date is set", passed: isDateExact(chapter.date) },
    { label: "End date is set", passed: !!chapter.date_end },
    {
      label: "At least one challenge exists",
      passed: challengeCount > 0,
    },
  ];
}

export function validateHackingReady(
  registrationCount: number
): StatusCheck[] {
  return [
    {
      label: "At least one team is registered",
      passed: registrationCount > 0,
    },
  ];
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
 * Get all status checks needed for a given target status.
 * This is the pure logic version without DB calls.
 * The counts (challengeCount, registrationCount, etc.) must be provided externally.
 */
export function getStatusChecksForTarget(
  currentStatus: ChapterStatus,
  targetStatus: ChapterStatus,
  chapter: ChapterFields,
  counts: {
    challengeCount?: number;
    registrationCount?: number;
    submissionCount?: number;
    juryCount?: number;
    publishedScoreCount?: number;
  }
): StatusCheck[] {
  if (isBackwardTransition(currentStatus, targetStatus)) return [];

  const targetIdx = getTargetIndex(targetStatus);
  const checks: StatusCheck[] = [];

  // Announced (idx 1)
  if (targetIdx >= 1) {
    checks.push(...validateAnnouncedReady(chapter));
  }

  // Applications Open (idx 2)
  if (targetIdx >= 2) {
    checks.push(...validateApplicationsOpenReady(chapter));
  }

  // Screening (idx 3) - no extra checks, just close applications

  // Challenge Selection / registration_open (idx 4)
  if (targetIdx >= 4) {
    checks.push(
      ...validateRegistrationOpenReady(chapter, counts.challengeCount ?? 0)
    );
  }

  // Submissions Open (idx 5) - require at least one registration
  if (targetIdx >= 5) {
    checks.push(...validateHackingReady(counts.registrationCount ?? 0));
  }

  // Pitching (idx 6)
  if (targetIdx >= 6) {
    checks.push(
      ...validatePitchingReady(
        counts.submissionCount ?? 0,
        counts.juryCount ?? 0
      )
    );
  }

  // Completed (idx 7)
  if (targetIdx >= 7) {
    checks.push(...validateCompletedReady(counts.publishedScoreCount ?? 0));
  }

  return checks;
}
