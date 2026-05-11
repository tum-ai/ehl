"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import {
  renderTeamInviteEmail,
  renderJoinRequestEmail,
} from "@/lib/emails/render";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Check if a user is locked to their current team because
 * the team has a challenge_registration for a chapter that
 * is not yet completed. Returns an error message or null.
 */
async function getChapterLockError(
  adminClient: SupabaseClient,
  userId: string
): Promise<string | null> {
  // Find the user's current team
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .single();

  if (!membership) return null; // no team, no lock

  // Check if that team has any challenge_registration for a non-completed chapter
  const { data: registrations } = await adminClient
    .from("challenge_registrations")
    .select("chapter_id, chapters!inner(status)")
    .eq("team_id", membership.team_id as string);

  if (!registrations || registrations.length === 0) return null;

  const locked = registrations.some((r) => {
    const chapter = r.chapters as unknown as { status: string };
    return chapter.status !== "completed";
  });

  if (locked) {
    return "You cannot change teams while your current team is registered for an active chapter.";
  }

  return null;
}

// ─── Accept team invite ──────────────────────────────────

export async function acceptTeamInvite(token: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  const { data: invite } = await adminClient
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .eq("status", "pending")
    .single();

  if (!invite) {
    return { error: "Invalid or expired invite." };
  }

  if (new Date(invite.expires_at as string) < new Date()) {
    await adminClient
      .from("team_invites")
      .update({ status: "expired" })
      .eq("id", invite.id);
    return { error: "This invite has expired." };
  }

  // Check capacity (max 5)
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", invite.team_id as string);

  if ((members?.length ?? 0) >= 5) {
    return { error: "This team is already full (5 members max)." };
  }

  // Check if user is locked to their current team via chapter registration
  const lockError = await getChapterLockError(adminClient, user.id);
  if (lockError) return { error: lockError };

  // If user is already on a team (but not locked), remove them first
  const { data: existingMembership } = await adminClient
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .single();

  if (existingMembership) {
    if (existingMembership.role === "president") {
      return { error: "You are the president of a team. Transfer presidency or disband your team first." };
    }
    await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", existingMembership.team_id as string)
      .eq("user_id", user.id);
  }

  // Add to team
  const { error: insertError } = await adminClient.from("team_members").insert({
    team_id: invite.team_id,
    user_id: user.id,
    role: "member",
  });

  if (insertError) {
    // Rollback: re-add user to their old team if they were removed
    if (existingMembership) {
      await adminClient.from("team_members").insert({
        team_id: existingMembership.team_id,
        user_id: user.id,
        role: existingMembership.role,
      });
    }
    return { error: "Could not join team. It may be full. Please try again." };
  }

  // Mark invite as accepted
  await adminClient
    .from("team_invites")
    .update({ status: "accepted" })
    .eq("id", invite.id);

  return { success: true };
}

export async function declineTeamInvite(token: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  await adminClient
    .from("team_invites")
    .update({ status: "declined" })
    .eq("token", token)
    .eq("status", "pending");

  return { success: true };
}

// ─── Captain: invite a member post-registration ──────────

export async function inviteMember(teamId: string, email: string, name?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  // Verify caller is president of this team
  const { data: team } = await adminClient
    .from("teams")
    .select("id, name, president_user_id")
    .eq("id", teamId)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can invite members." };
  }

  // Check capacity
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);

  if ((members?.length ?? 0) >= 5) {
    return { error: "Team is full (5 members max)." };
  }

  // Check for existing pending invite
  const { data: existingInvite } = await adminClient
    .from("team_invites")
    .select("id")
    .eq("team_id", teamId)
    .eq("email", email.toLowerCase())
    .eq("status", "pending")
    .single();

  if (existingInvite) {
    return { error: "An invite for this email is already pending." };
  }

  // Get captain name
  const { data: profile } = await adminClient
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const captainName = (profile?.name as string) || "Your president";

  // Create invite
  const { data: invite, error: inviteError } = await adminClient
    .from("team_invites")
    .insert({
      team_id: teamId,
      email: email.toLowerCase(),
      name: name || null,
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (inviteError || !invite) {
    return { error: inviteError?.message || "Failed to create invite." };
  }

  // Send email
  const html = await renderTeamInviteEmail({
    recipientName: name || null,
    recipientEmail: email,
    teamName: team.name as string,
    inviterName: captainName,
    inviteToken: invite.token as string,
  });

  await sendEmail({
    to: email,
    subject: `Join ${team.name} in the European Hackathon League`,
    html,
  });

  return { success: true };
}

export async function cancelInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  // Verify caller is president of the invite's team
  const { data: invite } = await adminClient
    .from("team_invites")
    .select("team_id")
    .eq("id", inviteId)
    .eq("status", "pending")
    .single();

  if (!invite) {
    return { error: "Invite not found." };
  }

  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", invite.team_id as string)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can cancel invites." };
  }

  await adminClient
    .from("team_invites")
    .update({ status: "expired" })
    .eq("id", inviteId);

  return { success: true };
}

// ─── Update team ──────────────────────────────────────────

export async function updateTeam(formData: FormData) {
  const teamId = formData.get("teamId") as string;
  const name = formData.get("name") as string;
  const university = (formData.get("university") as string) || null;
  const city = (formData.get("city") as string) || null;

  if (!teamId || !name) {
    return { error: "Team ID and name are required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Verify caller is team president
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "president") {
    return { error: "Only the team president can update team details." };
  }

  const { error } = await supabase
    .from("teams")
    .update({ name, university, city })
    .eq("id", teamId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ─── Toggle looking for members ──────────────────────────

export async function toggleLookingForMembers(teamId: string, value: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  // Verify caller is president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", teamId)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can change this setting." };
  }

  // If enabling, check team is not full
  if (value) {
    const { data: members } = await adminClient
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId);

    if ((members?.length ?? 0) >= 5) {
      return { error: "Team is already full. Cannot look for more members." };
    }
  }

  await adminClient
    .from("teams")
    .update({ looking_for_members: value })
    .eq("id", teamId);

  return { success: true };
}

// ─── Toggle looking for team ─────────────────────────────

export async function toggleLookingForTeam(value: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  await adminClient
    .from("profiles")
    .update({ looking_for_team: value })
    .eq("id", user.id);

  return { success: true };
}

// ─── Request to join a team (from dashboard) ──────────────

export async function requestToJoinTeam(teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Check if user is locked to their current team via chapter registration
  const lockError = await getChapterLockError(adminClient, user.id);
  if (lockError) return { error: lockError };

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

  // Check for existing pending request (dashboard-level, chapter_id is null)
  const { data: existingRequest } = await adminClient
    .from("team_join_requests")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .is("chapter_id", null)
    .eq("status", "pending")
    .single();

  if (existingRequest) {
    return { error: "You already have a pending request to join this team." };
  }

  // Get team info
  const { data: team } = await adminClient
    .from("teams")
    .select("id, name, president_user_id, looking_for_members")
    .eq("id", teamId)
    .single();

  if (!team) return { error: "Team not found." };
  if (!team.looking_for_members) return { error: "This team is not looking for members." };

  // Check team capacity
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);

  if ((members?.length ?? 0) >= 5) {
    return { error: "This team is already full." };
  }

  // Create join request
  const { error: insertError } = await adminClient
    .from("team_join_requests")
    .insert({
      team_id: teamId,
      user_id: user.id,
      chapter_id: null,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  // Get requester profile
  const { data: requesterProfile } = await adminClient
    .from("profiles")
    .select("name, email")
    .eq("id", user.id)
    .single();

  // Get captain profile for email
  const { data: captainProfile } = await adminClient
    .from("profiles")
    .select("name, email")
    .eq("id", team.president_user_id as string)
    .single();

  if (captainProfile?.email) {
    const html = await renderJoinRequestEmail({
      captainName: (captainProfile.name as string) || "President",
      requesterName: (requesterProfile?.name as string) || (requesterProfile?.email as string) || "A participant",
      requesterEmail: (requesterProfile?.email as string) || user.email || "",
      teamName: team.name as string,
    });

    sendEmail({
      to: captainProfile.email as string,
      subject: `${(requesterProfile?.name as string) || "Someone"} wants to join ${team.name}`,
      html,
    }).catch((err) => console.error("Failed to send join request email:", err));
  }

  return { success: true };
}

// ─── Captain: resolve dashboard join request ────────────────

export async function resolveDashboardJoinRequest(
  requestId: string,
  approved: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  const adminClient = createAdminClient();

  // Get the request
  const { data: request } = await adminClient
    .from("team_join_requests")
    .select("id, team_id, user_id, status")
    .eq("id", requestId)
    .eq("status", "pending")
    .is("chapter_id", null)
    .single();

  if (!request) {
    return { error: "Request not found or already resolved." };
  }

  // Verify caller is president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", request.team_id as string)
    .single();

  if (!team || team.president_user_id !== user.id) {
    return { error: "Only the team president can resolve join requests." };
  }

  if (approved) {
    // Check if the requester is locked to another team
    const lockError = await getChapterLockError(adminClient, request.user_id as string);
    if (lockError) return { error: lockError };

    // Check capacity
    const { count } = await adminClient
      .from("team_members")
      .select("*", { count: "exact", head: true })
      .eq("team_id", request.team_id as string);

    if ((count ?? 0) >= 5) {
      return { error: "Team already has 5 members (maximum)." };
    }

    // If user is already on another team (but not locked), remove them first
    const { data: existingMembership } = await adminClient
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", request.user_id as string)
      .single();

    if (existingMembership) {
      if (existingMembership.role === "president") {
        return { error: "This user is the president of another team and cannot join yours." };
      }
      await adminClient
        .from("team_members")
        .delete()
        .eq("team_id", existingMembership.team_id as string)
        .eq("user_id", request.user_id as string);
    }

    // Add user to team
    const { error: insertError } = await adminClient.from("team_members").insert({
      team_id: request.team_id,
      user_id: request.user_id,
      role: "member",
    });

    if (insertError) {
      return { error: insertError.message };
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

  return { success: true };
}
