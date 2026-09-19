"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction, getActingUserId } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import { renderFinaleInviteEmail } from "@/lib/emails/render";
import { sendAcceptanceEmailForApplication } from "@/lib/acceptance-email";
import { runBudgetedConcurrent } from "@/lib/bulk-send";
import { checkRateLimit, rsvpLimiter, rsvpTokenLimiter } from "@/lib/ratelimit";
import { logEvent } from "@/lib/event-log";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { FINALE_INVITE_MAX_RANK, FINALE_INVITE_SUBJECT } from "@/lib/finale";

// ─── Grand Finale invites ────────────────────────────────────
//
// The top league teams do not apply for the Finale through the public form. The
// organizers already decided they are in, so every current member of a
// qualifying team gets a personal link with two buttons. "I'm in" IS the
// application: it creates an accepted application for the Finale chapter and
// sends the normal acceptance email with the check-in QR. "I'm out" is recorded
// and nothing else happens.
//
// Shapes copied deliberately from lib/actions/rsvp.ts, which solved the same
// problems: a bearer token in an email, a read-only GET page (mail scanners
// prefetch every link), an answer written only by a POST, "first answer wins"
// enforced by the database, and an idempotent admin send where "row exists"
// means "already asked".

export type FinaleResponse = "yes" | "no";

export interface ResolvedFinaleInvite {
  firstName: string;
  teamName: string;
  /** null until the person has answered. The first answer is final. */
  response: FinaleResponse | null;
  /** True when "yes" produced (or found) an accepted application for them. */
  accepted: boolean;
}

// Tokens are uuid_generate_v4() values. Postgres REJECTS a non-uuid literal in
// `invite_token = ?` rather than returning no rows, so without this check a
// mangled token (mail clients wrap and truncate long URLs) renders a 500 rather
// than a clean 404. It also keeps the miss response uniform.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(token: string): boolean {
  return UUID_RE.test(token);
}

function isFinaleResponse(value: unknown): value is FinaleResponse {
  return value === "yes" || value === "no";
}

async function clientIp(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Statuses that must never be auto-promoted to accepted by a click. */
const NOT_PROMOTABLE = ["cancelled"];

// ─── Resolve an invite from its token (public) ───────────────
//
// THIS FUNCTION MUST NEVER WRITE. The emailed link is fetched by mail scanners
// before the recipient sees the message, so any state change here would be made
// by a robot on their behalf. The answer is written only by
// respondToFinaleInvite(), behind a deliberate click.
// tests/finale-invite-no-write-on-get.test.ts pins this.
//
// A real DB error THROWS (into the error boundary) instead of collapsing to
// null, so a Supabase outage does not make every emailed link look dead.
export async function getFinaleInviteByToken(
  token: string
): Promise<ResolvedFinaleInvite | null> {
  if (!token || !isUuid(token)) return null;

  const rl = await checkRateLimit(rsvpLimiter, await clientIp(), "finale-invite");
  if (rl.limited) return null;

  const adminClient = createAdminClient();

  const { data: row, error } = await adminClient
    .from("finale_invites")
    .select("email, response, application_id, teams!inner(name), profiles!inner(name)")
    .eq("invite_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  // PostgREST types an embedded to-one join as an array in some client versions.
  const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as
    | Record<string, unknown>
    | undefined;
  const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as
    | Record<string, unknown>
    | undefined;

  const response = row.response as string | null;

  return {
    firstName: firstNameOf((profile?.name as string) ?? "", row.email as string),
    teamName: (team?.name as string) ?? "your team",
    response: isFinaleResponse(response) ? response : null,
    accepted: !!row.application_id,
  };
}

/** "Ada Lovelace" -> "Ada". Falls back to the local part of the email. */
function firstNameOf(fullName: string, email: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  if (first) return first;
  return email.split("@")[0];
}

/** "Ada Lovelace" -> ["Ada", "Lovelace"]. last_name is NOT NULL, so never empty. */
function splitName(fullName: string, email: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { first: parts[0], last: parts.slice(1).join(" ") };
  if (parts.length === 1) return { first: parts[0], last: "-" };
  return { first: email.split("@")[0], last: "-" };
}

// ─── Record an answer (public, POST only) ────────────────────
//
// The first answer is FINAL, enforced by the database rather than a
// read-then-write gap: the update carries `.is("response", null)`, so two
// concurrent submits (a double click, or a click racing a retry) can only ever
// produce one stored answer, and therefore only ever one application.
export async function respondToFinaleInvite(
  token: string,
  response: FinaleResponse
): Promise<
  | { error: string }
  | { success: true; response: FinaleResponse; alreadyAnswered: boolean; accepted: boolean }
> {
  if (!token || !isUuid(token)) return { error: "Invalid invite link." };
  if (!isFinaleResponse(response)) return { error: "Invalid response." };

  const ipRl = await checkRateLimit(rsvpLimiter, await clientIp(), "finale-invite");
  if (ipRl.limited) return { error: ipRl.error! };
  const tokenRl = await checkRateLimit(rsvpTokenLimiter, token, "finale-invite-token");
  if (tokenRl.limited) return { error: tokenRl.error! };

  const adminClient = createAdminClient();

  const { data: claimed, error } = await adminClient
    .from("finale_invites")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("invite_token", token)
    .is("response", null)
    .select("id, chapter_id, team_id, user_id, email")
    .maybeSingle();

  if (error) return { error: "Could not record your answer. Please try again." };

  if (!claimed) {
    // Unknown token, or already answered. Distinguish with a read so someone who
    // double-clicked sees their standing answer, while an unknown token stays a
    // uniform failure (no existence oracle).
    const { data: existing } = await adminClient
      .from("finale_invites")
      .select("response, application_id")
      .eq("invite_token", token)
      .maybeSingle();

    const standing = existing?.response as string | null | undefined;
    if (isFinaleResponse(standing)) {
      return {
        success: true,
        response: standing,
        alreadyAnswered: true,
        accepted: !!existing?.application_id,
      };
    }
    return { error: "Invalid invite link." };
  }

  logEvent({
    // The token bearer is not a logged-in account, so this is a system event
    // carrying the invite it belongs to.
    action: "finale.invite_responded",
    entityType: "finale_invite",
    entityId: claimed.id as string,
    actorType: "system",
    delta: { response: { from: null, to: response } },
  });

  if (response === "no") {
    return { success: true, response, alreadyAnswered: false, accepted: false };
  }

  const accepted = await acceptInvitee({
    inviteId: claimed.id as string,
    chapterId: claimed.chapter_id as string,
    teamId: claimed.team_id as string,
    userId: claimed.user_id as string,
    email: claimed.email as string,
  });

  return { success: true, response, alreadyAnswered: false, accepted };
}

/**
 * Turn a "yes" into an accepted application for the Finale chapter.
 *
 * The answer is already recorded when this runs, so a failure here must never
 * fail the person's click: it returns false and leaves the invite answered but
 * unaccepted, which the admin board shows as "needs attention".
 *
 * applications is UNIQUE (chapter_id, email), so there are four cases:
 *   - no row            -> insert as accepted, details copied from their most
 *                          recent application at any earlier match
 *   - pending/waitlisted/rejected -> promote to accepted (they applied through
 *                          the public form before the invite reached them)
 *   - accepted/checked_in -> leave alone, no second acceptance email
 *   - cancelled         -> leave alone: an organizer removed them deliberately,
 *                          and a public link must not undo that
 */
async function acceptInvitee(opts: {
  inviteId: string;
  chapterId: string;
  teamId: string;
  userId: string;
  email: string;
}): Promise<boolean> {
  const adminClient = createAdminClient();

  const { data: existingApp } = await adminClient
    .from("applications")
    .select("id, status, acceptance_email_sent_at")
    .eq("chapter_id", opts.chapterId)
    .eq("email", opts.email)
    .maybeSingle();

  let applicationId: string | null = null;

  if (existingApp) {
    const status = existingApp.status as string;
    if (NOT_PROMOTABLE.includes(status)) return false;

    if (status !== "accepted" && status !== "checked_in") {
      const { error: updateErr } = await adminClient
        .from("applications")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", existingApp.id as string);
      if (updateErr) return false;
    }
    applicationId = existingApp.id as string;
  } else {
    // Copy identity and form answers from their most recent application at any
    // match, so a finalist fills in nothing. A person with no earlier
    // application (rare: an imported Makeathon team member) gets their name from
    // their profile and an empty form_data.
    const { data: previous } = await adminClient
      .from("applications")
      .select(
        "first_name, last_name, form_data, cv_url, consent_attendance, consent_privacy, consent_newsletter, consent_recruiting, consent_media"
      )
      .eq("email", opts.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: profile } = await adminClient
      .from("profiles")
      .select("name")
      .eq("id", opts.userId)
      .maybeSingle();

    const fallback = splitName((profile?.name as string) ?? "", opts.email);

    const { data: inserted, error: insertErr } = await adminClient
      .from("applications")
      .insert({
        chapter_id: opts.chapterId,
        email: opts.email,
        first_name: (previous?.first_name as string) ?? fallback.first,
        last_name: (previous?.last_name as string) ?? fallback.last,
        status: "accepted",
        form_data: previous?.form_data ?? {},
        cv_url: (previous?.cv_url as string | null) ?? null,
        existing_team_id: opts.teamId,
        team_members: [],
        // Clicking "I'm in" on the invite page is the attendance and privacy
        // consent; the page states that above the buttons. The optional
        // consents are never invented: they are copied from the earlier
        // application or left false.
        consent_attendance: true,
        consent_privacy: true,
        consent_newsletter: (previous?.consent_newsletter as boolean) ?? false,
        consent_recruiting: (previous?.consent_recruiting as boolean) ?? false,
        consent_media: (previous?.consent_media as boolean) ?? false,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("Finale invite: application insert failed", insertErr);
      return false;
    }
    applicationId = inserted.id as string;
  }

  await adminClient
    .from("finale_invites")
    .update({ application_id: applicationId })
    .eq("id", opts.inviteId);

  // The acceptance email (with the QR code) is deferred so the click returns
  // immediately. If it fails, acceptance_email_sent_at stays null and the
  // admin's existing "send pending emails" button picks the person up.
  sendEmailAfterResponse("finale-acceptance", async () => {
    await sendAcceptanceEmailForApplication(applicationId as string);
  });

  return true;
}

// ─── Admin: send the invites ─────────────────────────────────
//
// Idempotent by construction: a finale_invites row exists only once someone has
// been invited, so this mails exactly the qualifying members who have no row
// yet. Pressing the button twice mails nobody twice, and a team that qualifies
// later (or a member who joins later) is picked up on the next press.
//
// Global admins only: this reaches across every team in the league, not just
// one chapter's applicants.
export async function sendFinaleInvites(chapterId: string): Promise<
  | { error: string }
  | { success: true; sent: number; remaining: number; failed: string[]; teams: number }
> {
  const authErr = await requireAdminAction();
  if (authErr) return { error: authErr };

  const adminClient = createAdminClient();

  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id, is_finale, status")
    .eq("id", chapterId)
    .maybeSingle();

  if (!chapter) return { error: "Match not found." };
  if (!chapter.is_finale) return { error: "Finale invites can only be sent for the Grand Finale." };
  if (chapter.status === "draft" || chapter.status === "completed") {
    return { error: "This match is not open for invites." };
  }

  const qualifying = await getQualifyingTeams();
  if (qualifying.length === 0) return { error: "No teams qualify yet." };

  const teamIds = qualifying.map((t) => t.teamId);
  const teamNames = new Map(qualifying.map((t) => [t.teamId, t.teamName]));

  const { data: members, error: memberErr } = await adminClient
    .from("team_members")
    .select("team_id, user_id, profiles!inner(name, email)")
    .in("team_id", teamIds)
    .limit(QUERY_LIMITS.finaleInvites);

  if (memberErr) return { error: "Could not load team members." };

  const { data: invited } = await adminClient
    .from("finale_invites")
    .select("user_id")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.finaleInvites);

  const alreadyInvited = new Set((invited ?? []).map((r) => r.user_id as string));

  // A person on two qualifying teams is invited ONCE (the unique constraint
  // would reject the second row anyway); the first team wins.
  const pending: Array<{ userId: string; teamId: string; email: string; name: string }> = [];
  const seen = new Set<string>();
  for (const m of members ?? []) {
    const userId = m.user_id as string;
    if (alreadyInvited.has(userId) || seen.has(userId)) continue;
    const profile = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as
      | Record<string, unknown>
      | undefined;
    const email = (profile?.email as string)?.toLowerCase().trim();
    if (!email) continue;
    seen.add(userId);
    pending.push({
      userId,
      teamId: m.team_id as string,
      email,
      name: (profile?.name as string) ?? "",
    });
  }

  if (pending.length === 0) {
    return { success: true, sent: 0, remaining: 0, failed: [], teams: qualifying.length };
  }

  let sent = 0;
  const failed: string[] = [];

  // Concurrency matching the SMTP pool plus a wall-clock budget, exactly like
  // sendRsvpEmails. The row is inserted first (so the token comes from the
  // column default) and rolled back if the send fails, so nobody is silently
  // marked as invited.
  const { skipped } = await runBudgetedConcurrent(pending, async (person) => {
    const { data: inserted, error: insertErr } = await adminClient
      .from("finale_invites")
      .insert({
        chapter_id: chapterId,
        team_id: person.teamId,
        user_id: person.userId,
        email: person.email,
      })
      .select("invite_token")
      .single();

    if (insertErr || !inserted?.invite_token) {
      failed.push(person.email);
      return;
    }

    try {
      const html = await renderFinaleInviteEmail({
        firstName: firstNameOf(person.name, person.email),
        teamName: teamNames.get(person.teamId) ?? "your team",
        inviteToken: inserted.invite_token as string,
      });

      await sendEmail({
        to: person.email,
        subject: FINALE_INVITE_SUBJECT,
        html,
        skipRateLimit: true,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send Finale invite to ${person.email}:`, err);
      await adminClient
        .from("finale_invites")
        .delete()
        .eq("chapter_id", chapterId)
        .eq("user_id", person.userId);
      failed.push(person.email);
    }
  });

  if (sent > 0) {
    logEvent({
      action: "finale.invites_sent",
      entityType: "chapter",
      entityId: chapterId,
      actorId: await getActingUserId(),
      actorType: "admin",
      delta: { finale_invites: { sent, failed: failed.length, skipped: skipped.length } },
    });
  }

  return { success: true, sent, remaining: skipped.length, failed, teams: qualifying.length };
}

interface QualifyingTeam {
  teamId: string;
  teamName: string;
  rank: number;
  points: number;
}

/**
 * Teams ranked FINALE_INVITE_MAX_RANK or better on the season leaderboard.
 *
 * The view already ranks by total points with ties sharing a rank (00067), so
 * every team tied at the cutoff is included: the public table and the invite
 * list can never disagree.
 */
async function getQualifyingTeams(): Promise<QualifyingTeam[]> {
  const adminClient = createAdminClient();

  const { data } = await adminClient
    .from("leaderboard")
    .select("team_id, team_name, rank, total_points")
    .lte("rank", FINALE_INVITE_MAX_RANK)
    .order("rank", { ascending: true })
    .limit(QUERY_LIMITS.leaderboard);

  return (data ?? []).map((r) => ({
    teamId: r.team_id as string,
    teamName: r.team_name as string,
    rank: r.rank as number,
    points: r.total_points as number,
  }));
}

export interface FinaleInviteMember {
  name: string;
  email: string;
  response: FinaleResponse | null;
  invited: boolean;
  accepted: boolean;
}

export interface FinaleInviteTeam {
  teamId: string;
  teamName: string;
  rank: number;
  points: number;
  members: FinaleInviteMember[];
}

export interface FinaleInviteBoard {
  teams: FinaleInviteTeam[];
  counts: { invited: number; in: number; out: number; awaiting: number; notInvited: number };
}

/**
 * Everything the admin board shows: the qualifying teams, who answered what,
 * and who has not been invited yet. `notInvited` equals exactly what the next
 * press of the send button will mail, so the counter cannot promise work the
 * button will not do (the lesson behind lib/rsvp-stats.ts).
 */
export async function getFinaleInviteBoard(
  chapterId: string
): Promise<{ error: string } | FinaleInviteBoard> {
  const authErr = await requireAdminAction();
  if (authErr) return { error: authErr };

  const adminClient = createAdminClient();
  const qualifying = await getQualifyingTeams();
  const teamIds = qualifying.map((t) => t.teamId);

  if (teamIds.length === 0) {
    return { teams: [], counts: { invited: 0, in: 0, out: 0, awaiting: 0, notInvited: 0 } };
  }

  const { data: members } = await adminClient
    .from("team_members")
    .select("team_id, user_id, profiles!inner(name, email)")
    .in("team_id", teamIds)
    .limit(QUERY_LIMITS.finaleInvites);

  const { data: invites } = await adminClient
    .from("finale_invites")
    .select("user_id, response, application_id")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.finaleInvites);

  const inviteByUser = new Map(
    (invites ?? []).map((i) => [
      i.user_id as string,
      { response: i.response as FinaleResponse | null, accepted: !!i.application_id },
    ])
  );

  const counts = { invited: 0, in: 0, out: 0, awaiting: 0, notInvited: 0 };
  const seen = new Set<string>();

  const teams: FinaleInviteTeam[] = qualifying.map((t) => ({ ...t, members: [] }));
  const byTeam = new Map(teams.map((t) => [t.teamId, t]));

  for (const m of members ?? []) {
    const userId = m.user_id as string;
    const profile = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as
      | Record<string, unknown>
      | undefined;
    const invite = inviteByUser.get(userId);
    byTeam.get(m.team_id as string)?.members.push({
      name: (profile?.name as string) ?? "",
      email: (profile?.email as string) ?? "",
      response: invite?.response ?? null,
      invited: !!invite,
      accepted: !!invite?.accepted,
    });

    // Count each PERSON once, mirroring the send (one invite per person even if
    // they sit on two qualifying teams).
    if (seen.has(userId)) continue;
    seen.add(userId);
    if (!invite) counts.notInvited++;
    else {
      counts.invited++;
      if (invite.response === "yes") counts.in++;
      else if (invite.response === "no") counts.out++;
      else counts.awaiting++;
    }
  }

  return { teams, counts };
}
