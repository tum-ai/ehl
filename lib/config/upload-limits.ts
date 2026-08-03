/**
 * Upload size limits for files that travel inside a request body.
 *
 * Client-safe on purpose: this module reads NO environment variables, so it can
 * be imported from client components (UI copy, pre-submit guards) and from
 * server actions alike. It deliberately does NOT live in `limits.ts`, whose
 * env-driven `envInt()` lookups are server-shaped.
 *
 * THE BINDING CONSTRAINT IS NOT OURS. Vercel rejects any request whose body
 * exceeds ~4.5MB at the edge, BEFORE middleware runs and BEFORE the server
 * action is invoked. `experimental.serverActions.bodySizeLimit` in
 * next.config.ts raises only Next's own limit and cannot lift the platform one.
 *
 * Two consequences that are easy to get wrong:
 *
 * 1. A size guard inside a server action can never produce a message for an
 *    oversized CV, because the function is never reached. The client-side guard
 *    is the only one that can. The server guard below is kept as defence in
 *    depth against a caller that is not our form, not as the user-facing check.
 * 2. Raising this number alone does not make bigger uploads work. It only moves
 *    where they fail, from our friendly message to an opaque platform 413.
 *
 * This is exactly how a 10MB promise the platform could not keep reached
 * production: a 4.6MB CV was rejected at the edge and surfaced as a generic
 * "check your connection" error, leaving no application row, no server log, and
 * no way for the applicant to know that their CV was the problem.
 *
 * CV_MAX_BYTES sits deliberately BELOW the platform limit because the CV is not
 * the whole request. The same multipart body carries the profile fields, up to
 * four team members, and the Turnstile token, so a CV of exactly 4.5MB still
 * exceeds the limit once encoded.
 *
 * To accept CVs larger than the platform limit, the file has to stop travelling
 * through the function at all (direct browser-to-storage upload, with the server
 * relaying storage to Drive afterwards). Until that lands, keep CV_MAX_BYTES
 * under PLATFORM_REQUEST_BODY_LIMIT_BYTES.
 */

/**
 * Vercel's per-request body limit. Enforced at the edge and NOT configurable
 * from this repo. Present so the relationship to CV_MAX_BYTES is asserted by a
 * test rather than remembered.
 */
export const PLATFORM_REQUEST_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/** Largest CV accepted by the apply and walk-in forms. */
export const CV_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Render a byte count as the megabyte label users are shown. Whole numbers stay
 * whole ("4MB"); a fractional cap keeps one decimal ("4.5MB").
 */
export function megabyteLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))}MB`;
}

/**
 * Human-readable form of CV_MAX_BYTES. Single source for the field label AND
 * every error message.
 *
 * DERIVED, not written out: a hand-maintained label is a second copy of the
 * limit that can drift from the enforced one, which is the exact failure this
 * module exists to prevent (the form advertised 10MB while the platform
 * enforced ~4.5MB). Changing CV_MAX_BYTES now updates every user-facing string
 * automatically, so drift is impossible rather than merely detected by a test.
 */
export const CV_MAX_LABEL = megabyteLabel(CV_MAX_BYTES);

/** Shown when the pre-submit guard catches an oversized CV. */
export const CV_TOO_LARGE_MESSAGE =
  `Your CV is too large. Please upload a PDF under ${CV_MAX_LABEL}. ` +
  `Exporting it as text rather than scanned images usually gets it well under the limit.`;

/**
 * Shown when the request itself was rejected as too large. Distinct from
 * CV_TOO_LARGE_MESSAGE: this one names a cause the user can act on for a
 * failure our own guard did not catch first.
 */
export const REQUEST_TOO_LARGE_MESSAGE =
  `Your application was too large to send. This is almost always the CV: ` +
  `please compress it below ${CV_MAX_LABEL} and try again.`;
