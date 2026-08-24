import type { Team, TeamMember, Profile } from "@/lib/types";
import type { ParticipantWithTeam } from "@/lib/queries/teams";

/**
 * Search predicates for the admin Teams page.
 *
 * Extracted from the view so they can be unit tested: on an event day the
 * Teams tab is how an operator finds one person out of several hundred, and a
 * filter that silently misses a match is indistinguishable from the person not
 * being registered.
 *
 * Both tabs match on the same idea: type anything you know about the person or
 * the team (a name, an email, a university) and the row should surface. The
 * Teams tab therefore searches member identity too, because an operator is
 * usually holding a person, not a team name.
 */

export type MemberWithProfile = TeamMember & { profile?: Profile };

/** Case-insensitive, whitespace-trimmed needle. Empty means "no filter". */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle);
}

/** A member matches on their display name or their email. */
function memberMatches(member: MemberWithProfile, needle: string): boolean {
  return (
    contains(member.profile?.name, needle) || contains(member.profile?.email, needle)
  );
}

/**
 * Normalizes its own query, so calling it directly is safe. Only `filterTeams`
 * pre-normalizes, as a per-call saving across a large list; a public predicate
 * that silently required lowercase input would be a trap.
 */
export function teamMatches(
  team: Team,
  members: readonly MemberWithProfile[],
  rawNeedle: string
): boolean {
  const needle = normalizeQuery(rawNeedle);
  if (!needle) return true;
  return (
    contains(team.name, needle) ||
    contains(team.university, needle) ||
    contains(team.city, needle) ||
    contains(team.slug, needle) ||
    members.some((m) => memberMatches(m, needle))
  );
}

export function filterTeams(
  teams: readonly Team[],
  membersByTeam: ReadonlyMap<string, MemberWithProfile[]>,
  query: string
): Team[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...teams];
  return teams.filter((t) => teamMatches(t, membersByTeam.get(t.id) ?? [], needle));
}

/** Normalizes its own query; see `teamMatches`. */
export function participantMatches(p: ParticipantWithTeam, rawNeedle: string): boolean {
  const needle = normalizeQuery(rawNeedle);
  if (!needle) return true;
  return (
    contains(p.name, needle) ||
    contains(p.email, needle) ||
    contains(p.teamName, needle)
  );
}

export function filterParticipants(
  participants: readonly ParticipantWithTeam[],
  query: string
): ParticipantWithTeam[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...participants];
  return participants.filter((p) => participantMatches(p, needle));
}
