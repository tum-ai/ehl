/**
 * Pure helpers for screening-time participant flag derivation.
 *
 * Extracted from the applications enrichment route so the no-show inference
 * is independently unit-testable.
 */

export type PastApplication = {
  /** Application status at that chapter (e.g. "checked_in"). */
  status: string;
  /** The chapter the past application belongs to. */
  chapterId: string;
};

export type ComputeNoShowsArgs = {
  /** The applicant's past applications at OTHER chapters. */
  otherApps: PastApplication[];
  /** The applicant's league team id, or null if not on a league team. */
  teamId: string | null;
  /** Set of `${teamId}:${chapterId}` keys that DID produce a submission. */
  teamChapterSubmissions: Set<string>;
  /**
   * Set of chapter ids where check-in was actually available, i.e. at least
   * one application in that chapter has a real check-in record (a non-null
   * `checked_in_at`). Chapters absent from this set predate the check-in
   * feature (e.g. the first hackathon), where attendance was never recorded,
   * so the absence of a submission there must NOT be read as a no-show.
   */
  checkinEnabledChapters: Set<string>;
};

/**
 * Count the number of past events where the applicant genuinely no-showed:
 * they checked in but their team submitted nothing.
 *
 * A no-show is only counted for chapters where check-in actually ran. Legacy
 * pre-check-in chapters (the first hackathon) are excluded, because there the
 * `checked_in` status reflects migrated/assumed attendance rather than a real
 * check-in, and "no submission" cannot distinguish absence from a missing
 * legacy record. Without this guard every participant in a pre-check-in event
 * would be falsely flagged as a no-show.
 */
export function computeNoShows({
  otherApps,
  teamId,
  teamChapterSubmissions,
  checkinEnabledChapters,
}: ComputeNoShowsArgs): number {
  if (!teamId) return 0;

  let noShows = 0;
  for (const other of otherApps) {
    if (other.status !== "checked_in") continue;
    // Suppress no-shows for chapters that predate the check-in feature.
    if (!checkinEnabledChapters.has(other.chapterId)) continue;
    const key = `${teamId}:${other.chapterId}`;
    if (!teamChapterSubmissions.has(key)) {
      noShows++;
    }
  }
  return noShows;
}

/**
 * Build the set of chapter ids where check-in was actually available, from the
 * full application list. A chapter qualifies if any of its applications carries
 * a real check-in record (non-null `checked_in_at`).
 */
export function buildCheckinEnabledChapters(
  applications: { chapterId: string; checkedInAt: string | null }[]
): Set<string> {
  const enabled = new Set<string>();
  for (const app of applications) {
    if (app.checkedInAt) {
      enabled.add(app.chapterId);
    }
  }
  return enabled;
}
