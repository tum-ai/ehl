"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import {
  renderTeamInviteEmail,
  renderJoinRequestEmail,
} from "@/lib/emails/render";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/event-log";
import { MAX_TEAM_SIZE } from "@/lib/config/limits";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { getCurrentMembership, getLockingTeamId } from "@/lib/team-membership";

/**
 * Check if a user is locked to a team because that team has a
 * challenge_registration for a chapter that is not yet completed.
 * Returns an error message or null.
 *
 * Considers ALL of the user's memberships (a user can hold several across
 * completed chapters), matching the DB-level 00035 insert trigger: any active
 * registration locks them in place.
 */
async function getChapterLockError(
  adminClient: SupabaseClient,
  userId: string
): Promise<string | null> {
  const lockingTeamId = await getLockingTeamId(adminClient, userId);

  if (lockingTeamId) {
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

  // The invite is bound to a specific email. Don't let a logged-in user with
  // a different account consume an invite addressed to someone else.
  const userEmail = (user.email ?? "").toLowerCase();
  if ((invite.email as string).toLowerCase() !== userEmail) {
    return {
      error: "This invite was sent to a different email address. Sign in with that address to accept it.",
    };
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

  if ((members?.length ?? 0) >= MAX_TEAM_SIZE) {
    return { error: `This team is already full (${MAX_TEAM_SIZE} members max).` };
  }

  // Check if user is locked to their current team via chapter registration
  const lockError = await getChapterLockError(adminClient, user.id);
  if (lockError) return { error: lockError };

  // If user is already on a team (but not locked), remove them first
  const existingMembership = await getCurrentMembership(adminClient, user.id);

  if (existingMembership) {
    if (existingMembership.role === "president") {
      return { error: "You are the president of a team and cannot switch teams." };
    }
    await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", existingMembership.teamId)
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
        team_id: existingMembership.teamId,
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

  logEvent({
    action: "team.invite_accepted",
    entityType: "team",
    entityId: invite.team_id as string,
    actorId: user.id,
    actorType: "participant",
    delta: { created: { user_id: user.id } },
  });

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

  // Check capacity: current members + pending invites must be < MAX_TEAM_SIZE
  const [{ data: members }, { count: pendingInvites }] = await Promise.all([
    adminClient.from("team_members").select("user_id").eq("team_id", teamId),
    adminClient.from("team_invites").select("id", { count: "exact", head: true }).eq("team_id", teamId).eq("status", "pending"),
  ]);

  const totalCommitted = (members?.length ?? 0) + (pendingInvites ?? 0);
  if (totalCommitted >= MAX_TEAM_SIZE) {
    return { error: `Team is full (${members?.length ?? 0} members + ${pendingInvites ?? 0} pending invites = ${MAX_TEAM_SIZE} max).` };
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

  // Upsert on (team_id, email). team_invites has UNIQUE(team_id, email) and
  // rows are never deleted (decline/cancel/expiry just change status), so a
  // plain insert when re-inviting a previously-declined/expired email would
  // hit the constraint and surface a raw DB error. Upserting resets the row to
  // a fresh pending invite with a new token and expiry.
  const { data: invite, error: inviteError } = await adminClient
    .from("team_invites")
    .upsert(
      {
        team_id: teamId,
        email: email.toLowerCase(),
        name: name || null,
        invited_by: user.id,
        status: "pending",
        token: randomUUID(),
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      },
      { onConflict: "team_id,email" }
    )
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

  try {
    await sendEmail({
      to: email,
      subject: `Join ${team.name} in the European Hackathon League`,
      html,
    });
  } catch (err) {
    // The invite row exists; surface the email failure rather than throwing a
    // raw server-action error with no feedback to the president.
    console.error(`Failed to send team invite to ${email}:`, err);
    return {
      error: "Invite created, but the email could not be sent. They can still join from a link, or try again.",
    };
  }

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

  logEvent({
    action: "team.updated",
    entityType: "team",
    entityId: teamId,
    actorId: user.id,
    actorType: "participant",
    delta: { updated: { name } },
  });

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

    if ((members?.length ?? 0) >= MAX_TEAM_SIZE) {
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

  // Update and CONFIRM a row was actually changed. Previously this returned
  // success even when 0 rows matched (e.g. a user whose profile row was missing),
  // so the toggle silently "didn't stick". Select the updated row back and error
  // if nothing was updated, so a missing profile surfaces instead of hiding.
  const { data: updated, error: updateError } = await adminClient
    .from("profiles")
    .update({ looking_for_team: value })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { error: "Could not update your status. Please try again." };
  }
  if (!updated) {
    return { error: "Your profile could not be found. Please reload and try again." };
  }

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
  const existingMembership = await getCurrentMembership(adminClient, user.id);

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

  if ((members?.length ?? 0) >= MAX_TEAM_SIZE) {
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

    sendEmailAfterResponse(`join request to ${captainProfile.email}`, () =>
      sendEmail({
        to: captainProfile.email as string,
        subject: `${(requesterProfile?.name as string) || "Someone"} wants to join ${team.name}`,
        html,
      })
    );
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

    if ((count ?? 0) >= MAX_TEAM_SIZE) {
      return { error: "Team already has 5 members (maximum)." };
    }

    // If user is already on another team (but not locked), remove them first
    const existingMembership = await getCurrentMembership(
      adminClient,
      request.user_id as string
    );

    if (existingMembership) {
      if (existingMembership.role === "president") {
        return { error: "This user is the president of another team and cannot join yours." };
      }
      await adminClient
        .from("team_members")
        .delete()
        .eq("team_id", existingMembership.teamId)
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

// ─── Create team (for already logged-in users) ──────────

export async function createTeam(teamName: string, university?: string, city?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in." };

  const adminClient = createAdminClient();

  // Check user doesn't already have a team
  const existingMembership = await getCurrentMembership(adminClient, user.id);

  if (existingMembership) {
    return { error: "You are already on a team." };
  }

  if (!teamName || teamName.trim().length < 2) {
    return { error: "Team name must be at least 2 characters." };
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
      university: university?.trim() || null,
      city: city?.trim() || null,
      president_user_id: user.id,
      status: "active",
    })
    .select("id, name, slug")
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
    action: "team.created",
    entityType: "team",
    entityId: team.id,
    actorId: user.id,
    actorType: "participant",
    delta: { created: { name: teamName } },
  });

  revalidatePath("/dashboard");
  return { success: true, team };
}

// ─── Leave team ──────────────────────────────────────────

export async function leaveTeam() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in." };

  const adminClient = createAdminClient();

  // Get user's team membership
  const membership = await getCurrentMembership(adminClient, user.id);

  if (!membership) {
    return { error: "You are not on a team." };
  }

  if (membership.role === "president") {
    return { error: "Presidents cannot leave their team. Contact an admin if you need to be removed." };
  }

  // Check if user is locked to team via active chapter
  const lockError = await getChapterLockError(adminClient, user.id);
  if (lockError) return { error: lockError };

  // Remove from team
  await adminClient
    .from("team_members")
    .delete()
    .eq("team_id", membership.teamId)
    .eq("user_id", user.id);

  logEvent({
    action: "team.member_left",
    entityType: "team",
    entityId: membership.teamId,
    actorId: user.id,
    actorType: "participant",
    delta: { deleted: { user_id: user.id } },
  });

  revalidatePath("/dashboard");
  return { success: true };
}
