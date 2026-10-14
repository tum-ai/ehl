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

// ─── Applicant -> event-team mapping ─────────────────────────
//
// Pure core of the showcase's team resolution: challenge_registrations.roster
// holds the profile ids of the members who ACTUALLY played at this chapter, so
// roster -> profile.email -> applications.email is the authoritative bridge
// (a person's global team may pre/post-date the event). Emails are lowercased
// on both sides defensively, matching lib/queries/teams.ts.
export function buildTeamNameByEmail(
  registrations: Array<{ teamName: string; roster: string[] }>,
  profiles: Array<{ id: string; email: string | null }>
): Map<string, string> {
  const teamNameByUserId = new Map<string, string>();
  for (const reg of registrations) {
    for (const uid of reg.roster) {
      teamNameByUserId.set(uid, reg.teamName);
    }
  }
  const teamNameByEmail = new Map<string, string>();
  for (const p of profiles) {
    const teamName = teamNameByUserId.get(p.id);
    if (teamName && p.email) {
      teamNameByEmail.set(p.email.toLowerCase(), teamName);
    }
  }
  return teamNameByEmail;
}

// ─── Teams paired with their members and submission ─────────
//
// One entry per challenge registration: the team, the consented applicants who
// PLAYED on it (same roster -> profile.email -> applications.email bridge as
// buildTeamNameByEmail), and the project it submitted for that challenge.
// Roster members without sponsor consent are never named, only counted in
// hiddenMemberCount, so the team view cannot widen the consent gate.
//
// A submission shows only its project name, description, tech stack and the
// http(s) links of its url/repo fields. File fields (Drive ids) and free-text
// answers are left out: they were written for the jury, not for sponsors.

export interface ShowcaseSubmissionLink {
  label: string;
  url: string;
}

export interface ShowcaseSubmissionSummary {
  projectName: string;
  shortDescription: string | null;
  techStack: string[];
  links: ShowcaseSubmissionLink[];
}

export interface ShowcaseTeam<M> {
  teamId: string;
  teamName: string;
  challengeName: string;
  placement: number | null;
  points: number | null;
  members: M[];
  hiddenMemberCount: number;
  submission: ShowcaseSubmissionSummary | null;
}

export interface ShowcaseTeamInputs<M> {
  registrations: Array<{
    teamId: string;
    teamName: string;
    challengeId: string;
    roster: string[];
  }>;
  challenges: Array<{
    id: string;
    title: string;
    submissionFields: Array<{ key: string; label: string; type: string }>;
  }>;
  profiles: Array<{ id: string; email: string | null }>;
  // Consented applicants only, keyed by lowercased email (server-side only).
  memberByEmail: Map<string, M>;
  submissions: Array<{
    teamId: string;
    challengeId: string;
    projectName: string;
    shortDescription: string | null;
    techStack: unknown;
    fields: unknown;
  }>;
  ranking: Array<{
    teamId: string;
    challengeId: string | null;
    placement: number | null;
    points: number;
  }>;
}

function httpLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function buildShowcaseTeams<M>(input: ShowcaseTeamInputs<M>): ShowcaseTeam<M>[] {
  const challengeById = new Map(input.challenges.map((c) => [c.id, c]));
  const emailByUserId = new Map(
    input.profiles
      .filter((p) => p.email)
      .map((p) => [p.id, (p.email as string).toLowerCase()])
  );
  const submissionByKey = new Map(
    input.submissions.map((s) => [`${s.teamId}:${s.challengeId}`, s])
  );
  const scoreByKey = new Map(
    input.ranking
      .filter((r) => r.challengeId)
      .map((r) => [`${r.teamId}:${r.challengeId}`, r])
  );

  const teams = input.registrations.map((reg) => {
    const challenge = challengeById.get(reg.challengeId);
    const members: M[] = [];
    let hiddenMemberCount = 0;
    for (const uid of new Set(reg.roster)) {
      const email = emailByUserId.get(uid);
      const member = email ? input.memberByEmail.get(email) : undefined;
      if (member) members.push(member);
      else hiddenMemberCount += 1;
    }

    const sub = submissionByKey.get(`${reg.teamId}:${reg.challengeId}`);
    let submission: ShowcaseSubmissionSummary | null = null;
    if (sub) {
      const fields = (sub.fields && typeof sub.fields === "object" ? sub.fields : {}) as Record<string, unknown>;
      const links: ShowcaseSubmissionLink[] = [];
      for (const field of challenge?.submissionFields ?? []) {
        if (field.type !== "url" && field.type !== "repo") continue;
        const url = httpLink(fields[field.key]);
        if (url) links.push({ label: field.label, url });
      }
      submission = {
        projectName: sub.projectName,
        shortDescription: sub.shortDescription,
        techStack: Array.isArray(sub.techStack)
          ? sub.techStack.filter((t): t is string => typeof t === "string")
          : [],
        links,
      };
    }

    const score = scoreByKey.get(`${reg.teamId}:${reg.challengeId}`);
    return {
      teamId: reg.teamId,
      teamName: reg.teamName,
      challengeName: challenge?.title ?? "",
      placement: score?.placement ?? null,
      points: score?.points ?? null,
      members,
      hiddenMemberCount,
      submission,
    };
  });

  // Placed teams first (by placement), then teams with a project, then by name.
  return teams.sort((a, b) => {
    const pa = a.placement ?? Number.POSITIVE_INFINITY;
    const pb = b.placement ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    if (Boolean(a.submission) !== Boolean(b.submission)) return a.submission ? -1 : 1;
    return a.teamName.localeCompare(b.teamName);
  });
}

// ─── People who submitted a project ──────────────────────────
//
// Distinct roster members of every registration that has a submission for its
// challenge. A bare count for the hero: it names nobody, so it covers members
// without sponsor consent too. Someone on two submitting registrations counts
// once.
export function countSubmitters(
  registrations: Array<{ teamId: string; challengeId: string; roster: string[] }>,
  submissions: Array<{ teamId: string; challengeId: string }>
): number {
  const submitted = new Set(submissions.map((s) => `${s.teamId}:${s.challengeId}`));
  const people = new Set<string>();
  for (const reg of registrations) {
    if (!submitted.has(`${reg.teamId}:${reg.challengeId}`)) continue;
    for (const uid of reg.roster) people.add(uid);
  }
  return people.size;
}

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
