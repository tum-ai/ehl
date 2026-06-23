import type { ApplicationStatus } from "@/lib/types";

/**
 * Statuses an admin may target with a chapter broadcast. Deliberately excludes
 * `rejected`, `cancelled`, and `pending`: a broadcast is for people who are
 * attending (or on the waitlist), never for those who were turned away or who
 * have not been decided. Enforced server-side regardless of client input.
 */
export const BROADCASTABLE_STATUSES: ApplicationStatus[] = [
  "accepted",
  "checked_in",
  "waitlisted",
];

export const DEFAULT_BROADCAST_STATUSES: ApplicationStatus[] = [
  "accepted",
  "checked_in",
];

/**
 * Normalize a requested status filter to the allowed set: keep only
 * broadcastable statuses, dedupe, and preserve a stable order. Returns an empty
 * array if nothing valid remains (the caller should reject that).
 */
export function sanitizeBroadcastStatuses(
  requested: readonly string[] | null | undefined
): ApplicationStatus[] {
  if (!requested) return [];
  const allowed = new Set<string>(BROADCASTABLE_STATUSES);
  const seen = new Set<string>();
  const out: ApplicationStatus[] = [];
  for (const s of requested) {
    if (allowed.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s as ApplicationStatus);
    }
  }
  return out;
}

/**
 * The acceptance email subject for a chapter: the admin's custom subject if set
 * and non-empty, else the legacy default. Kept pure so the fallback is testable
 * and identical wherever it is computed.
 */
export function acceptanceEmailSubject(
  customSubject: string | null | undefined,
  chapterName: string
): string {
  const trimmed = customSubject?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `You're in! Accepted for ${chapterName}`;
}
