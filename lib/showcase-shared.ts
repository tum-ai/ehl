// Pure, non-server helpers for the partner showcase.
//
// This module deliberately has NO "use server" directive: a server-action file
// (lib/actions/showcase.ts) may only export async functions, so the shared
// predicate, SQL-filter constant, and types live here where the public page,
// the CV proxy, the query layer, and unit tests can all import them freely.

// ─── Shared applicant-visibility predicate ───────────────────
//
// SINGLE SOURCE OF TRUTH for which applicants a sponsor may see. Used by BOTH
// the public showcase query and the CV proxy, so a person hidden from the list
// can never have their CV fetched.
//
// Consent is the hard gate: an applicant appears ONLY if they opted into sharing
// their profile with recruiters/sponsors. In this codebase a single optional
// "share my profile with recruiters and sponsors" checkbox drives both
// consent_sponsor_data and consent_recruiting. We OR the two because
// consent_sponsor_data only exists from migration 00034 onward: applications
// created before it have consent_sponsor_data = false even when the applicant
// ticked the box at the time (which set consent_recruiting = true). The OR
// recovers those legitimately-consented pre-00034 applicants.
//
// Status is NOT a gate: the product wants all applicants (applied, accepted,
// even rejected) visible, with actual participants (checked_in) badged. Status
// only drives the visible label, not visibility.
export function hasSponsorConsent(a: {
  consentSponsorData?: boolean | null;
  consentRecruiting?: boolean | null;
}): boolean {
  return Boolean(a.consentSponsorData) || Boolean(a.consentRecruiting);
}

// The equivalent PostgREST/SQL filter, applied server-side so unconsented rows
// never leave the database. Kept next to hasSponsorConsent() so the two cannot
// drift.
export const SPONSOR_CONSENT_OR_FILTER =
  "consent_sponsor_data.eq.true,consent_recruiting.eq.true";

// ─── Showcase domain types ───────────────────────────────────

// A resolved, LIVE showcase: the row exists, is_enabled is true, and it has not
// expired. This is what the public page and CV proxy resolve a token to.
export interface ResolvedShowcase {
  chapterId: string;
  showCvs: boolean;
}

// Partner showcase settings (admin-facing).
export interface ShowcaseSettings {
  chapterId: string;
  token: string;
  isEnabled: boolean;
  showCvs: boolean;
  expiresAt: string | null;
  rotatedAt: string | null;
}
