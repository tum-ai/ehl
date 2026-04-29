import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Team, TeamMember, Profile, TeamJoinRequest, TeamInvite } from "../types";
import { getClient } from "./client";
import { toTeam, toTeamMember, toProfile, toJoinRequest, toTeamInvite } from "./mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";

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
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .single();
  if (!membership) return null;

  const { data: teamRow } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id as string)
    .single();
  if (!teamRow) return null;

  return {
    team: toTeam(teamRow),
    role: membership.role as "president" | "member",
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
