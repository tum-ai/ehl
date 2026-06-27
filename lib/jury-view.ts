/**
 * Pure, null-safe render decisions for the admin Jury page.
 *
 * The page maps over a chapter's challenges and reads each challenge's progress
 * entry (`progress[challenge.id]`). A challenge with NO progress entry yet (e.g.
 * a brand-new challenge, or before any juror is added) has `cp === undefined`.
 * An unguarded `cp.finalized` in the render crashed the WHOLE /admin/jury page
 * (TypeError: Cannot read properties of undefined (reading 'finalized')), which
 * looked like "I get redirected and can't add a jury member". These helpers make
 * the missing-entry case a tested guarantee instead of relying on scattered `?.`.
 */

export interface ChallengeProgressLike {
  finalized: boolean;
  jurors: { status: "pending" | "voted" | "skipped" }[];
}

/** A challenge's finalized-recovery block shows only when its progress exists AND is finalized. */
export function shouldShowFinalizedBlock(
  cp: ChallengeProgressLike | undefined | null
): boolean {
  return Boolean(cp?.finalized);
}

/** True when the challenge has at least one assigned juror (null-safe). */
export function hasJury(cp: ChallengeProgressLike | undefined | null): boolean {
  return Boolean(cp && cp.jurors.length > 0);
}
