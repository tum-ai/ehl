import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Team, TeamMember, Profile, TeamJoinRequest, TeamInvite } from "../types";
import { getClient } from "./client";
import { toTeam, toTeamMember, toProfile, toJoinRequest, toTeamInvite } from "./mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { getCurrentMembership } from "@/lib/team-membership";

// ─── Team Queries ─────────────────────────────────────────

export async function getTeams(): Promise<Team[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("teams")
    .select("*")
    .order("name")
    .limit(QUERY_LIMITS.teams);
  return (data ?? []).map(toTeam);
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("teams")
    .select("*")
    .eq("slug", slug)
    .single();
  return data ? toTeam(data) : null;
}

export async function getTeamForUser(
  userId: string
): Promise<{ team: Team; role: "president" | "member" } | null> {
  // Uses admin client: team_members RLS requires auth, but this runs
  // server-side for public/participant pages. Read-only, no write risk.
  const supabase = createAdminClient();
  // A user may hold several memberships (past teams from completed chapters),
  // so this resolves the current one instead of failing on a multi-row result.
  const membership = await getCurrentMembership(supabase, userId);
  if (!membership) return null;

  const { data: teamRow } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.teamId)
    .single();
  if (!teamRow) return null;

  return {
    team: toTeam(teamRow),
    role: membership.role,
  };
}

export async function searchTeams(
  query: string
): Promise<Team[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("teams")
    .select("*")
    .ilike("name", `%${query}%`)
    .eq("status", "active")
    .order("name")
    .limit(20);
  return (data ?? []).map(toTeam);
}

// ─── Team Member Queries ──────────────────────────────────

export async function getTeamMembers(
  teamId: string
): Promise<TeamMember[]> {
  // Uses admin client: team_members RLS requires auth, but this runs
  // server-side for public team pages. Read-only, no write risk.
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .order("role");
  return (data ?? []).map(toTeamMember);
}

export async function getTeamMembersWithProfiles(
  teamId: string
): Promise<(TeamMember & { profile?: Profile })[]> {
  // Uses admin client: team_members RLS requires auth, but this runs
  // server-side for dashboard/API routes. Read-only, no write risk.
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("team_id", teamId)
    .order("role");
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...toTeamMember(row),
    profile: row.profiles ? toProfile(row.profiles as Record<string, unknown>) : undefined,
  }));
}

export async function getAllTeamMembers(): Promise<
  (TeamMember & { profile?: Profile })[]
> {
  // Uses admin client: team_members RLS requires auth, but this runs
  // server-side for admin pages. Read-only, no write risk.
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .order("role")
    .limit(QUERY_LIMITS.allTeamMembers);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...toTeamMember(row),
    profile: row.profiles ? toProfile(row.profiles as Record<string, unknown>) : undefined,
  }));
}

// ─── Teams Looking for Members ────────────────────────────

export interface TeamLookingForMembers extends Team {
  memberCount: number;
  memberNames: string[];
}

export interface UpcomingEventRecruiting {
  chapter: {
    id: string;
    name: string;
    slug: string;
    city: string;
    date: string;
    dateEnd: string | null;
  };
  teamIds: string[];
}

/**
 * Return the current or next public event plus teams whose president has an
 * active application for that event. The RPC deliberately returns only public
 * chapter fields and team IDs, never private application rows or identities.
 */
export async function getUpcomingEventRecruiting(): Promise<UpcomingEventRecruiting | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("get_upcoming_event_recruiting");

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    chapter_id: string;
    chapter_name: string;
    chapter_slug: string;
    chapter_city: string;
    chapter_date: string;
    chapter_date_end: string | null;
    team_id: string | null;
  }>;
  const first = rows[0];
  if (!first) return null;

  return {
    chapter: {
      id: first.chapter_id,
      name: first.chapter_name,
      slug: first.chapter_slug,
      city: first.chapter_city,
      date: first.chapter_date,
      dateEnd: first.chapter_date_end,
    },
    teamIds: Array.from(
      new Set(rows.flatMap((row) => (row.team_id ? [row.team_id] : [])))
    ),
  };
}

export async function getTeamsLookingForMembers(): Promise<TeamLookingForMembers[]> {
  // Uses admin client: team_members RLS requires auth, but this runs
  // server-side for dashboard. Read-only, no write risk.
  const supabase = createAdminClient();
  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("looking_for_members", true)
    .eq("status", "active")
    .order("name");

  if (!teams || teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id as string);
  const { data: members } = await supabase
    .from("team_members")
    .select("team_id, profiles!inner(name)")
    .in("team_id", teamIds);

  const memberMap = new Map<string, string[]>();
  const countMap = new Map<string, number>();
  for (const m of members ?? []) {
    const tid = m.team_id as string;
    countMap.set(tid, (countMap.get(tid) ?? 0) + 1);
    const profile = m.profiles as unknown as Record<string, unknown> | null;
    const name = (profile?.name as string) || null;
    if (name) {
      const existing = memberMap.get(tid) ?? [];
      existing.push(name);
      memberMap.set(tid, existing);
    }
  }

  return teams
    .map((t) => ({
      ...toTeam(t),
      memberCount: countMap.get(t.id as string) ?? 0,
      memberNames: memberMap.get(t.id as string) ?? [],
    }))
    .filter((t) => t.memberCount < 5);
}

// ─── Team Invite Queries ──────────────────────────────────

export async function getPendingInvitesForTeam(
  teamId: string
): Promise<TeamInvite[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("team_invites")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map(toTeamInvite);
}

// ─── Dashboard Join Request Queries ──────────────────────

export async function getDashboardJoinRequestsForTeam(
  teamId: string
): Promise<TeamJoinRequest[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("team_join_requests")
    .select("*, profiles!team_join_requests_user_id_fkey(name, email)")
    .eq("team_id", teamId)
    .is("chapter_id", null)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map((row: Record<string, unknown>) => {
    const profile = row.profiles as Record<string, unknown> | null;
    return {
      ...toJoinRequest(row),
      userName: (profile?.name as string) ?? null,
      userEmail: (profile?.email as string) ?? null,
    };
  });
}

export async function getPendingJoinRequestsForUser(
  userId: string
): Promise<TeamJoinRequest[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("team_join_requests")
    .select("*, teams!inner(name)")
    .eq("user_id", userId)
    .is("chapter_id", null)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map((row: Record<string, unknown>) => {
    const team = row.teams as Record<string, unknown> | null;
    return {
      ...toJoinRequest(row),
      teamName: (team?.name as string) ?? null,
    };
  });
}

export async function getUsersLookingForTeam(): Promise<
  { id: string; name: string | null; email: string | null }[]
> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("looking_for_team", true)
    .eq("role", "participant")
    .order("name")
    .limit(QUERY_LIMITS.usersLookingForTeam);

  if (!data) return [];

  const userIds = data.map((d) => d.id as string);
  if (userIds.length === 0) return [];

  const { data: memberships } = await supabase
    .from("team_members")
    .select("user_id")
    .in("user_id", userIds);

  const memberSet = new Set((memberships ?? []).map((m) => m.user_id as string));

  return data
    .filter((d) => !memberSet.has(d.id as string))
    .map((d) => ({
      id: d.id as string,
      name: (d.name as string) ?? null,
      email: (d.email as string) ?? null,
    }));
}

// ─── Team Match History ─────────────────────────────────

export interface TeamMatchHistoryEntry {
  chapter: { id: string; name: string; slug: string; date: string | null; city: string | null; status: string };
  challenge: { id: string; title: string } | null;
  registration: { roster: string[]; registeredAt: string } | null;
  submission: { projectName: string; createdAt: string } | null;
  score: { placement: number | null; points: number; challengeName: string } | null;
}

export async function getTeamMatchHistory(teamId: string): Promise<TeamMatchHistoryEntry[]> {
  const adminClient = createAdminClient();

  // Fetch all data in parallel
  const [
    { data: registrations },
    { data: scores },
    { data: submissions },
    { data: chapters },
    { data: challenges },
  ] = await Promise.all([
    adminClient.from("challenge_registrations").select("chapter_id, challenge_id, team_id, roster, registered_at").eq("team_id", teamId),
    adminClient.from("scores").select("chapter_id, team_id, challenge_name, placement, points").eq("team_id", teamId),
    adminClient.from("submissions").select("challenge_id, team_id, project_name, created_at").eq("team_id", teamId),
    adminClient.from("chapters").select("id, name, slug, date, city, status").neq("status", "draft"),
    adminClient.from("challenges").select("id, title, chapter_id"),
  ]);

  const chapterMap = new Map((chapters ?? []).map(c => [c.id as string, c]));
  const challengeMap = new Map((challenges ?? []).map(c => [c.id as string, c]));
  const scoreMap = new Map((scores ?? []).map(s => [`${s.chapter_id}`, s]));
  const submissionMap = new Map((submissions ?? []).map(s => [s.challenge_id as string, s]));

  const history: TeamMatchHistoryEntry[] = [];

  for (const reg of registrations ?? []) {
    const chapter = chapterMap.get(reg.chapter_id as string);
    if (!chapter) continue;

    const challenge = challengeMap.get(reg.challenge_id as string);
    const submission = submissionMap.get(reg.challenge_id as string);
    const score = scoreMap.get(reg.chapter_id as string);

    history.push({
      chapter: {
        id: chapter.id as string,
        name: chapter.name as string,
        slug: chapter.slug as string,
        date: (chapter.date as string) ?? null,
        city: (chapter.city as string) ?? null,
        status: chapter.status as string,
      },
      challenge: challenge ? { id: challenge.id as string, title: challenge.title as string } : null,
      registration: { roster: (reg.roster as string[]) ?? [], registeredAt: reg.registered_at as string },
      submission: submission ? { projectName: submission.project_name as string, createdAt: submission.created_at as string } : null,
      score: score ? { placement: (score.placement as number) ?? null, points: (score.points as number) ?? 0, challengeName: (score.challenge_name as string) ?? "" } : null,
    });
  }

  // Sort by chapter date descending (most recent first)
  history.sort((a, b) => {
    if (!a.chapter.date) return 1;
    if (!b.chapter.date) return -1;
    return new Date(b.chapter.date).getTime() - new Date(a.chapter.date).getTime();
  });

  return history;
}

// ─── Admin: All Participants with Team Info ───────────────

export interface ParticipantWithTeam {
  id: string;
  name: string | null;
  email: string;
  teamId: string | null;
  teamName: string | null;
  teamSlug: string | null;
  teamRole: "president" | "member" | null;
  checkedIn: boolean;
  checkedInAt: string | null;
}

export async function getAllParticipantsWithTeams(
  chapterId?: string
): Promise<ParticipantWithTeam[]> {
  const supabase = createAdminClient();

  // Get all participant profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, name")
    .eq("role", "participant")
    .order("name")
    .limit(QUERY_LIMITS.allTeamMembers);

  if (!profiles) return [];

  // Get team memberships
  const { data: memberships } = await supabase
    .from("team_members")
    .select("user_id, team_id, role, teams(name, slug)")
    .limit(QUERY_LIMITS.allTeamMembers);

  const memberMap = new Map<string, { teamId: string; teamName: string; teamSlug: string; role: string }>();
  for (const m of memberships ?? []) {
    const team = m.teams as unknown as { name: string; slug: string } | null;
    memberMap.set(m.user_id as string, {
      teamId: m.team_id as string,
      teamName: team?.name ?? "",
      teamSlug: team?.slug ?? "",
      role: m.role as string,
    });
  }

  // Get check-in status for a specific chapter
  const checkedInEmails = new Set<string>();
  const checkedInAtMap = new Map<string, string>();
  if (chapterId) {
    const { data: apps } = await supabase
      .from("applications")
      .select("email, status, checked_in_at")
      .eq("chapter_id", chapterId)
      .eq("status", "checked_in")
      .limit(QUERY_LIMITS.allTeamMembers);
    for (const app of apps ?? []) {
      checkedInEmails.add((app.email as string).toLowerCase());
      if (app.checked_in_at) {
        checkedInAtMap.set((app.email as string).toLowerCase(), app.checked_in_at as string);
      }
    }
  }

  return profiles.map((p) => {
    const email = (p.email as string).toLowerCase();
    const membership = memberMap.get(p.id as string);
    return {
      id: p.id as string,
      name: (p.name as string) ?? null,
      email,
      teamId: membership?.teamId ?? null,
      teamName: membership?.teamName ?? null,
      teamSlug: membership?.teamSlug ?? null,
      teamRole: (membership?.role as "president" | "member") ?? null,
      checkedIn: checkedInEmails.has(email),
      checkedInAt: checkedInAtMap.get(email) ?? null,
    };
  });
}
