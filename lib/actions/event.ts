"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckinStatusForUsers } from "@/lib/queries/checkin";
import { slugify } from "@/lib/utils";
import { logEvent } from "@/lib/event-log";
import { MIN_CHALLENGE_ROSTER } from "@/lib/config/limits";

// ─── Get event status for a checked-in participant ──────────

export async function getEventStatus(chapterId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  // Check application status
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: "Profile not found." };
  }

  const { data: application } = await adminClient
    .from("applications")
    .select("id, status")
    .eq("chapter_id", chapterId)
    .eq("email", profile.email as string)
    .single();

  if (!application || application.status !== "checked_in") {
    return { error: "You must be checked in to access the event hub." };
  }

  // Get chapter info
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id, name, challenge_registration_enabled")
    .eq("id", chapterId)
    .single();

  // Get team membership
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id, role, teams!inner(id, name)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // Get challenge registration if team exists
  let challengeRegistration = null;
  if (membership) {
    const { data: reg } = await adminClient
      .from("challenge_registrations")
      .select("id, challenge_id, team_id, roster, registered_at, challenges!inner(title)")
      .eq("chapter_id", chapterId)
      .eq("team_id", membership.team_id as string)
      .single();

    if (reg) {
      const challenge = reg.challenges as unknown as Record<string, unknown>;
      challengeRegistration = {
        id: reg.id as string,
        challengeId: reg.challenge_id as string,
        challengeTitle: challenge.title as string,
        teamId: reg.team_id as string,
        roster: (reg.roster as string[]) ?? [],
        registeredAt: reg.registered_at as string,
      };
    }
  }

  // Get pending join requests (outgoing)
  const { data: outgoingRequests } = await adminClient
    .from("team_join_requests")
    .select("id, team_id, status, created_at, teams!inner(name)")
    .eq("user_id", user.id)
    .eq("chapter_id", chapterId)
    .eq("status", "pending");

  // Get incoming join requests (if president)
  let incomingRequests: Array<Record<string, unknown>> = [];
  if (membership && membership.role === "president") {
    const { data: incoming } = await adminClient
      .from("team_join_requests")
      .select("id, user_id, status, created_at, profiles!team_join_requests_user_id_fkey(name, email)")
      .eq("team_id", membership.team_id as string)
      .eq("chapter_id", chapterId)
      .eq("status", "pending");
    incomingRequests = incoming ?? [];
  }

  const team = membership
    ? {
        id: (membership.teams as unknown as Record<string, unknown>).id as string,
        name: (membership.teams as unknown as Record<string, unknown>).name as string,
        isPresident: membership.role === "president",
      }
    : null;

  return {
    success: true,
    userId: user.id,
    checkedIn: true,
    team,
    challengeRegistration,
    challengeRegistrationEnabled: (chapter?.challenge_registration_enabled as boolean) ?? false,
    pendingJoinRequests: (outgoingRequests ?? []).map((r) => ({
      id: r.id as string,
      teamId: r.team_id as string,
      teamName: (r.teams as unknown as Record<string, unknown>).name as string,
      status: r.status as string,
    })),
    incomingJoinRequests: incomingRequests.map((r) => {
      const profile = r.profiles as unknown as Record<string, unknown> | null;
      return {
        id: r.id as string,
        userId: r.user_id as string,
        userName: (profile?.name as string) ?? "Unknown",
        userEmail: (profile?.email as string) ?? "",
        status: r.status as string,
      };
    }),
  };
}

// ─── Event info panel (gated to attending applicants) ────────

/**
 * The chapter's admin-authored event info (Discord link, schedule, venue), but
 * ONLY for a participant who actually applied to this chapter and is attending
 * (accepted or checked_in). Event info is never exposed through the public
 * chapters read; this is the gated path that surfaces it. Returns null for
 * anyone who is not an attending applicant, so the panel simply does not render.
 */
export async function getChapterEventInfo(
  chapterId: string
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const adminClient = createAdminClient();

  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const { data: application } = await adminClient
    .from("applications")
    .select("status")
    .eq("chapter_id", chapterId)
    .eq("email", profile.email as string)
    .single();

  // Only people who are actually coming see the venue/Discord/schedule.
  if (
    !application ||
    (application.status !== "accepted" && application.status !== "checked_in")
  ) {
    return null;
  }

  const { data: comms } = await adminClient
    .from("chapter_communications")
    .select("event_info")
    .eq("chapter_id", chapterId)
    .single();

  return (comms?.event_info as string) ?? null;
}

// ─── Create a new team at the event ─────────────────────────

export async function createEventTeam(chapterId: string, teamName: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };
  if (!teamName.trim()) return { error: "Team name is required." };

  const adminClient = createAdminClient();

  // Verify user is checked in for this chapter
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (profile) {
    const { data: app } = await adminClient
      .from("applications")
      .select("status")
      .eq("chapter_id", chapterId)
      .eq("email", profile.email as string)
      .single();

    if (!app || app.status !== "checked_in") {
      return { error: "You must be checked in to create a team at this event." };
    }
  }

  // Check if user already has a team
  const { data: existingMembership } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (existingMembership) {
    return { error: "You are already a member of a team. Leave your current team first." };
  }

  const slug = slugify(teamName);

  // Check team name uniqueness
  const { data: existingTeam } = await adminClient
    .from("teams")
    .select("id")
    .eq("slug", slug)
    .single();

  if (existingTeam) {
    return { error: "A team with this name already exists." };
  }

  // Create team
  const { data: team, error: teamError } = await adminClient
    .from("teams")
    .insert({
      name: teamName.trim(),
      slug,
      president_user_id: user.id,
      status: "active",
    })
    .select("id, name")
    .single();

  if (teamError || !team) {
    return { error: teamError?.message || "Failed to create team." };
  }

  // Add user as president
  await adminClient.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    role: "president",
  });

  logEvent({
    action: "team.created_at_event",
    entityType: "team",
    entityId: team.id as string,
    actorType: "participant",
    delta: { created: { name: teamName.trim() } },
  });

  return { success: true, teamId: team.id as string, teamName: team.name as string };
}

// ─── Request to join a team ─────────────────────────────────

export async function requestJoinTeam(chapterId: string, teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Verify user is checked in for this chapter
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (profile) {
    const { data: app } = await adminClient
      .from("applications")
      .select("status")
      .eq("chapter_id", chapterId)
      .eq("email", profile.email as string)
      .single();

    if (!app || app.status !== "checked_in") {
      return { error: "You must be checked in to join a team at this event." };
    }
  }

  // Check if user already has a team
  const { data: existingMembership } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (existingMembership) {
    return { error: "You are already a member of a team." };
  }

  // Check for existing pending request
  const { data: existingRequest } = await adminClient
    .from("team_join_requests")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .eq("chapter_id", chapterId)
    .eq("status", "pending")
    .single();

  if (existingRequest) {
    return { error: "You already have a pending request to join this team." };
  }

  const { error } = await adminClient.from("team_join_requests").insert({
    team_id: teamId,
    user_id: user.id,
    chapter_id: chapterId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ─── President: resolve join request ────────────────────────

export async function resolveJoinRequest(
  requestId: string,
  approved: boolean
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Get the request
  const { data: request } = await adminClient
    .from("team_join_requests")
    .select("id, team_id, user_id, chapter_id, status")
    .eq("id", requestId)
    .single();

  if (!request || request.status !== "pending") {
    return { error: "Request not found or already resolved." };
  }

  // Verify requester is president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", request.team_id as string)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can approve join requests." };
  }

  if (approved) {
    // Re-check at approval time: the requester may have joined another team
    // (e.g. via an invite) since requesting. A second membership would break
    // getTeamForUser's .single() and flip their dashboard to the teamless view.
    const { data: existingMembership } = await adminClient
      .from("team_members")
      .select("team_id")
      .eq("user_id", request.user_id as string)
      .maybeSingle();

    if (existingMembership) {
      if (existingMembership.team_id === request.team_id) {
        // Already on this team: just resolve the request as approved below.
      } else {
        return {
          error: "This user has already joined another team. They must leave it first.",
        };
      }
    } else {
      // Check team size before approving
      const { count } = await adminClient
        .from("team_members")
        .select("*", { count: "exact", head: true })
        .eq("team_id", request.team_id as string);

      if ((count ?? 0) >= 5) {
        return { error: "Team already has 5 members (maximum)." };
      }

      // Add user to team
      const { error: insertError } = await adminClient.from("team_members").insert({
        team_id: request.team_id,
        user_id: request.user_id,
        role: "member",
      });
      if (insertError) {
        return { error: "Could not add the user to the team. Please try again." };
      }
    }
  }

  // Update request status
  await adminClient
    .from("team_join_requests")
    .update({
      status: approved ? "approved" : "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", requestId);

  logEvent({
    action: "team.join_resolved",
    entityType: "team",
    entityId: request.team_id as string,
    actorType: "participant",
    delta: { status: { from: "pending", to: approved ? "approved" : "rejected" } },
  });

  return { success: true };
}

// ─── President: register for a challenge ────────────────────

export async function registerChallenge(
  chapterId: string,
  challengeId: string,
  teamId: string,
  roster: string[]
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Verify president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", teamId)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can register for challenges." };
  }

  // Verify caller is checked in for this chapter
  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (callerProfile) {
    const { data: app } = await adminClient
      .from("applications")
      .select("status")
      .eq("chapter_id", chapterId)
      .eq("email", callerProfile.email as string)
      .single();

    if (!app || app.status !== "checked_in") {
      return { error: "You must be checked in to register for a challenge." };
    }
  }

  // Verify challenge registration is enabled and chapter is in the right status
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("challenge_registration_enabled, status")
    .eq("id", chapterId)
    .single();

  if (!chapter || !chapter.challenge_registration_enabled) {
    return { error: "Challenge registration is not currently enabled." };
  }

  // Verify challenge actually belongs to this chapter
  const { data: challengeRow } = await adminClient
    .from("challenges")
    .select("id")
    .eq("id", challengeId)
    .eq("chapter_id", chapterId)
    .single();

  if (!challengeRow) {
    return { error: "Invalid challenge for this chapter." };
  }

  // Verify roster size (2-5, president must be included)
  if (roster.length < MIN_CHALLENGE_ROSTER || roster.length > 5) {
    return { error: "Roster must have 2 to 5 members." };
  }

  if (!roster.includes(user.id)) {
    return { error: "The president must be included in the roster." };
  }

  // Verify all roster members are on the team
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);

  const memberIds = new Set((members ?? []).map((m) => m.user_id as string));
  for (const userId of roster) {
    if (!memberIds.has(userId)) {
      return { error: "All roster members must be on the team." };
    }
  }

  // Verify all roster members are checked in for this chapter
  const checkinStatus = await getCheckinStatusForUsers(roster, chapterId);
  const notCheckedIn = roster.filter((id) => !checkinStatus.get(id));
  if (notCheckedIn.length > 0) {
    // Get names for the error message
    const { data: notCheckedInProfiles } = await adminClient
      .from("profiles")
      .select("id, name")
      .in("id", notCheckedIn);
    const names = (notCheckedInProfiles ?? [])
      .map((p) => (p.name as string) || "Unknown")
      .join(", ");
    return {
      error: `All roster members must be checked in. Not checked in: ${names}`,
    };
  }

  // Check no existing registration for this team+chapter
  const { data: existing } = await adminClient
    .from("challenge_registrations")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .single();

  if (existing) {
    return { error: "Your team is already registered for a challenge at this event." };
  }

  // Insert registration
  const { error } = await adminClient.from("challenge_registrations").insert({
    chapter_id: chapterId,
    challenge_id: challengeId,
    team_id: teamId,
    roster,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ─── Search teams ───────────────────────────────────────────

export async function searchTeamsAction(query: string) {
  if (!query || query.length < 2) return [];

  // Require authentication
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("teams")
    .select("id, name, slug")
    .ilike("name", `%${query}%`)
    .eq("status", "active")
    .order("name")
    .limit(10);

  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    slug: t.slug as string,
  }));
}
