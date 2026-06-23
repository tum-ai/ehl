// Verify-time Entire gating, extracted so it is unit-testable without importing
// the full Next.js route (which pulls in session/github/rate-limit deps).

export type EntireFeedback = { entireOk?: boolean; entireWarning?: string };

/**
 * Merge a successful repo-verification response with the Entire feedback, and
 * BLOCK at verify time when the Entire gate definitively fails. The hard gate in
 * submitProject is the backstop, but surfacing it here (valid:false) means the
 * user finds out at "Verify", not after clicking Submit — the confusing UX from
 * the Paris dry-run.
 *
 * Important: only block on a DEFINITE failure (entireOk === false). A transient
 * error makes entireFeedback return {} (entireOk undefined); we must NOT block on
 * that (no false positives), matching the "stay silent on transient errors" rule.
 * When the gate passes (entireOk true) or is not applicable ({}), the feedback is
 * merged into the base response unchanged.
 */
export function withEntireGate(
  base: Record<string, unknown>,
  feedback: EntireFeedback
): Record<string, unknown> {
  if (feedback.entireOk === false) {
    return {
      valid: false,
      error:
        feedback.entireWarning ??
        "This challenge requires an Entire session record, which was not found in your repository.",
    };
  }
  return { ...base, ...feedback };
}
