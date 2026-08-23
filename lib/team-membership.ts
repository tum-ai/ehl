import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolving a user's CURRENT team.
 *
 * A user can legitimately hold more than one `team_members` row: migration
 * 00024 dropped the global unique index on `team_members(user_id)` so rosters
 * can change between chapters, and the 00035 trigger only forbids joining a
 * second team while the first one is registered for a NON-completed chapter.
 * So "one team per user" holds only within an active chapter, never globally.
 *
 * Code that asked for the membership with `.single()` therefore broke for every
 * user who had ever changed teams: PostgREST rejects a multi-row result, the
 * query returns null, and the caller concluded the user had no team at all
 * (empty dashboard, "you are not on a team" on leave, no chapter lock).
 *
 * These helpers replace that with a deterministic rule: the membership tied to
 * a team registered for an active chapter wins; failing that, the most recently
 * joined one. Historical memberships stay in the table and keep backing team
 * pages and certificates.
 */

export type MembershipRow = {
  teamId: string;
  role: "president" | "member";
  joinedAt: string | null;
};

type MembershipDbRow = {
  team_id: string;
  role: string;
  joined_at: string | null;
};

function toMembership(row: MembershipDbRow): MembershipRow {
  return {
    teamId: row.team_id,
    role: row.role === "president" ? "president" : "member",
    joinedAt: row.joined_at ?? null,
  };
}

/** Milliseconds since epoch, with unset/unparseable timestamps sorting oldest. */
function joinedAtMillis(membership: MembershipRow): number {
  if (!membership.joinedAt) return 0;
  const parsed = Date.parse(membership.joinedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Pick the user's current team out of all their memberships.
 *
 * Preference order:
 *   1. a team registered for a chapter that is not completed (the team they are
 *      actually competing with right now),
 *   2. the most recently joined team,
 *   3. on an exact `joined_at` tie, the lexicographically smallest team id, so
 *      the result never depends on row order.
 */
export function pickCurrentMembership(
  memberships: readonly MembershipRow[],
  activeTeamIds: ReadonlySet<string>
): MembershipRow | null {
  if (memberships.length === 0) return null;

  const active = memberships.filter((m) => activeTeamIds.has(m.teamId));
  const pool = active.length > 0 ? active : memberships;

  return [...pool].sort((a, b) => {
    const byRecency = joinedAtMillis(b) - joinedAtMillis(a);
    if (byRecency !== 0) return byRecency;
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  })[0];
}

/** Every team the user belongs to, newest first is NOT guaranteed (see picker). */
export async function getMembershipsForUser(
  client: SupabaseClient,
  userId: string
): Promise<MembershipRow[]> {
  const { data } = await client
    .from("team_members")
    .select("team_id, role, joined_at")
    .eq("user_id", userId);

  return ((data ?? []) as MembershipDbRow[]).map(toMembership);
}

/**
 * Of the given teams, those registered for a chapter that has not completed.
 * Mirrors the condition the 00035 `check_team_member_chapter_lock` trigger uses.
 */
export async function getActiveChapterTeamIds(
  client: SupabaseClient,
  teamIds: readonly string[]
): Promise<Set<string>> {
  if (teamIds.length === 0) return new Set();

  const { data } = await client
    .from("challenge_registrations")
    .select("team_id, chapters!inner(status)")
    .in("team_id", [...teamIds]);

  const active = new Set<string>();
  for (const row of data ?? []) {
    const chapter = (row as { chapters?: { status?: string } }).chapters;
    if (chapter?.status && chapter.status !== "completed") {
      active.add((row as { team_id: string }).team_id);
    }
  }
  return active;
}

/**
 * The user's current team, or null if they are on none. Only pays for the
 * chapter lookup when the user actually holds several memberships.
 */
export async function getCurrentMembership(
  client: SupabaseClient,
  userId: string
): Promise<MembershipRow | null> {
  const memberships = await getMembershipsForUser(client, userId);
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0];

  const activeTeamIds = await getActiveChapterTeamIds(
    client,
    memberships.map((m) => m.teamId)
  );
  return pickCurrentMembership(memberships, activeTeamIds);
}

/**
 * The id of a team that locks the user in place because it is registered for a
 * chapter that has not completed, or null when they are free to change teams.
 *
 * Checks ALL of the user's memberships, not just the current one: any active
 * registration locks, which is exactly what the DB trigger enforces on insert.
 */
export async function getLockingTeamId(
  client: SupabaseClient,
  userId: string
): Promise<string | null> {
  const memberships = await getMembershipsForUser(client, userId);
  if (memberships.length === 0) return null;

  const activeTeamIds = await getActiveChapterTeamIds(
    client,
    memberships.map((m) => m.teamId)
  );
  const locked = memberships.find((m) => activeTeamIds.has(m.teamId));
  return locked?.teamId ?? null;
}
