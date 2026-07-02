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
// The consent columns, in one place: hasSponsorConsent() ORs their camelCase
// twins and SPONSOR_CONSENT_OR_FILTER is DERIVED from this list, so the TS
// predicate and the SQL filter cannot drift apart (a test pins the derived
// string exactly).
export const SPONSOR_CONSENT_COLUMNS = [
  "consent_sponsor_data",
  "consent_recruiting",
] as const;

export function hasSponsorConsent(a: {
  consentSponsorData?: boolean | null;
  consentRecruiting?: boolean | null;
}): boolean {
  return Boolean(a.consentSponsorData) || Boolean(a.consentRecruiting);
}

// Adapter for raw Supabase rows (snake_case), so call sites don't hand-roll the
// column-to-field mapping — a transposed field there would silently weaken the
// consent gate.
export function rowHasSponsorConsent(row: {
  consent_sponsor_data?: unknown;
  consent_recruiting?: unknown;
}): boolean {
  return hasSponsorConsent({
    consentSponsorData: (row.consent_sponsor_data as boolean | null) ?? null,
    consentRecruiting: (row.consent_recruiting as boolean | null) ?? null,
  });
}

// The equivalent PostgREST .or() filter, applied server-side so unconsented
// rows never leave the database.
export const SPONSOR_CONSENT_OR_FILTER = SPONSOR_CONSENT_COLUMNS.map(
  (c) => `${c}.eq.true`
).join(",");

// ─── Podium eligibility ──────────────────────────────────────
//
// Placements are assigned PER CHALLENGE (finalizeChallengeScores gives each
// challenge its own 1..5), so a multi-challenge chapter legitimately holds
// several placement=1 rows. A 3-pillar podium can only represent UNIQUE top-3
// placements — keying by placement would silently drop a winning team from a
// sponsor-facing ranking. When this returns false, the view must render every
// placed row as a (challenge-labeled) list instead.
export function rankingSupportsPodium(
  rows: Array<{ placement: number | null }>
): boolean {
  const top3 = rows.filter((r) => r.placement !== null && r.placement <= 3);
  if (top3.length === 0) return false;
  return new Set(top3.map((r) => r.placement)).size === top3.length;
}

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
