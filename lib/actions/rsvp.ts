"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChapterAdminAction, getActingUserId } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { renderRsvpRequestEmail } from "@/lib/emails/render";
import { formatDateRange } from "@/lib/utils";
import { runBudgetedConcurrent } from "@/lib/bulk-send";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { checkRateLimit, rsvpLimiter, rsvpTokenLimiter } from "@/lib/ratelimit";
import { logEvent } from "@/lib/event-log";
import { isRsvpExpired, rsvpCutoffIso, formatRsvpDeadline } from "@/lib/rsvp-window";

// ─── Post-acceptance RSVP (statistics only) ──────────────────
//
// This module is deliberately self-contained and decoupled from the application
// workflow in lib/actions/applications.ts. It never reads or writes
// applications.status beyond selecting who is accepted, it is not part of the
// acceptance email, and deleting this file plus the application_rsvps table
// removes the feature entirely.

export type RsvpResponse = "yes" | "no";

export interface ResolvedRsvp {
  applicationId: string;
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  /** null until the applicant has answered. The first answer is final. */
  response: RsvpResponse | null;
  respondedAt: string | null;
  /** True once the response window has closed. Answers already given stand. */
  expired: boolean;
  /** Formatted deadline, shown to the applicant either way. */
  deadline: string;
}

// Tokens are uuid_generate_v4() values. Postgres REJECTS a non-uuid literal in
// `rsvp_token = ?` ("invalid input syntax for type uuid") rather than returning
// no rows, and this module deliberately throws on DB errors, so without this
// check a malformed token renders a 500 instead of a clean 404. That is not
// hypothetical: mail clients wrap and truncate long URLs, so real recipients
// arrive here with a mangled token. Shape-checking first also keeps the miss
// response UNIFORM (a garbage token and an unknown token are indistinguishable)
// and keeps junk out of the error reporting.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(token: string): boolean {
  return UUID_RE.test(token);
}

/** Only these two values are ever stored. Anything else is rejected outright. */
function isRsvpResponse(value: unknown): value is RsvpResponse {
  return value === "yes" || value === "no";
}

async function clientIp(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// ─── Resolve an application from an RSVP token (public) ──────
//
// The RSVP token lives in the admin-only application_rsvps table, which has NO
// anon read policy (RLS gates rows not columns, so the token could not live on
// the applications row without becoming readable by the applicant's own
// session). We therefore read it with the service-role client, look an
// application up BY token, and never expose the token list. A miss returns null
// UNIFORMLY, so the resolver is not an oracle distinguishing "no such token"
// from "token maps to a deleted application".
//
// THIS FUNCTION MUST NEVER WRITE. The emailed link is fetched by mail scanners
// (Outlook Safe Links and friends) before the recipient sees the message, so any
// state change here would be made by a robot on the applicant's behalf. The
// answer is written only by submitRsvp(), behind a deliberate click.
// tests/rsvp-no-write-on-get.test.ts pins this.
//
// As in getShowcaseByToken(), a real DB error THROWS (into the error boundary)
// instead of collapsing to null: a Supabase outage must not make every emailed
// RSVP link look permanently dead.
export async function getRsvpByToken(token: string): Promise<ResolvedRsvp | null> {
  if (!token || !isUuid(token)) return null;

  const rl = await checkRateLimit(rsvpLimiter, await clientIp(), "rsvp");
  if (rl.limited) return null;

  const adminClient = createAdminClient();

  const { data: row, error } = await adminClient
    .from("application_rsvps")
    .select(
      "application_id, response, responded_at, email_sent_at, applications!inner(first_name, chapters!inner(name, city, country, date, date_end))"
    )
    .eq("rsvp_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!row?.application_id) return null;

  // PostgREST types an embedded to-one join as an array in some client
  // versions, so normalise before reading.
  const application = (Array.isArray(row.applications) ? row.applications[0] : row.applications) as
    | Record<string, unknown>
    | undefined;
  if (!application) return null;

  const chapter = (Array.isArray(application.chapters) ? application.chapters[0] : application.chapters) as
    | Record<string, unknown>
    | undefined;
  if (!chapter) return null;

  const response = row.response as string | null;

  return {
    applicationId: row.application_id as string,
    firstName: application.first_name as string,
    chapterName: chapter.name as string,
    chapterCity: `${chapter.city}, ${chapter.country}`,
    chapterDate: formatDateRange(chapter.date as string, chapter.date_end as string | null),
    response: isRsvpResponse(response) ? response : null,
    respondedAt: (row.responded_at as string) ?? null,
    // An expired link is NOT a 404. Unlike the showcase token (which guards
    // other people's personal data, so its expiry collapses into a uniform
    // null), this token guards a one-bit self-report by the one person it was
    // mailed to. Telling that person "the window closed" is worth far more than
    // hiding that their own link was once valid, and a 404 would read as a
    // broken link and generate support mail.
    expired: isRsvpExpired(row.email_sent_at as string),
    deadline: formatRsvpDeadline(row.email_sent_at as string),
  };
}

// ─── Record an answer (public, POST only) ────────────────────
//
// The first answer is FINAL. The lock is enforced by the database, not by a
// read-then-write gap: the update carries `.is("response", null)`, so two
// concurrent submits (a double click, or a click racing a retry) can only ever
// produce one stored answer. A submit against an already-answered token is not
// an error, it just reports the answer that stands.
export async function submitRsvp(
  token: string,
  response: RsvpResponse
): Promise<
  | { error: string }
  | { success: true; response: RsvpResponse; alreadyAnswered: boolean }
> {
  if (!token || !isUuid(token)) return { error: "Invalid RSVP link." };
  if (!isRsvpResponse(response)) return { error: "Invalid response." };

  const ipRl = await checkRateLimit(rsvpLimiter, await clientIp(), "rsvp");
  if (ipRl.limited) return { error: ipRl.error! };
  const tokenRl = await checkRateLimit(rsvpTokenLimiter, token, "rsvp-token");
  if (tokenRl.limited) return { error: tokenRl.error! };

  const adminClient = createAdminClient();

  // The window is enforced by the SAME statement that records the answer
  // (email_sent_at must still be inside it), so a submit landing a millisecond
  // after the deadline cannot slip through a read-then-write gap.
  const { data: updated, error } = await adminClient
    .from("application_rsvps")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("rsvp_token", token)
    .is("response", null)
    .gt("email_sent_at", rsvpCutoffIso())
    .select("application_id, response")
    .maybeSingle();

  if (error) return { error: "Could not record your answer. Please try again." };

  if (updated?.application_id) {
    // Unauthenticated actor: the token bearer is not a logged-in account, so
    // this is a "system" event carrying the application it belongs to.
    logEvent({
      action: "application.rsvp_responded",
      entityType: "application",
      entityId: updated.application_id as string,
      actorType: "system",
      delta: { rsvp: { from: null, to: response } },
    });
    return { success: true, response, alreadyAnswered: false };
  }

  // No row updated: the token is unknown, already answered, or expired.
  // Distinguish with a read so an already-answered applicant sees their answer
  // and an expired one is told why, while an unknown token stays a uniform
  // failure.
  const { data: existing } = await adminClient
    .from("application_rsvps")
    .select("response, email_sent_at")
    .eq("rsvp_token", token)
    .maybeSingle();

  const standing = existing?.response as string | null | undefined;
  if (isRsvpResponse(standing)) {
    return { success: true, response: standing, alreadyAnswered: true };
  }

  if (existing && isRsvpExpired(existing.email_sent_at as string)) {
    return {
      error:
        "This RSVP link has expired. Please contact the organisers if you still want your spot.",
    };
  }

  return { error: "Invalid RSVP link." };
}

// ─── Admin: send the RSVP request to all accepted applicants ─
//
// Idempotent by construction: an application_rsvps row exists only once someone
// has been asked, so this mails exactly the accepted applicants who have no row
// yet. Pressing the button twice mails nobody twice; newly accepted people are
// picked up on the next press.
//
// ONE press mails everybody. There is no fixed chunk (sendBulkEmails() uses 40
// and makes the admin click three times for 85 applicants). Instead this
// borrows the two mechanisms the codebase already trusts elsewhere:
//
//   - concurrency, like sendCertificateEmails(): a job per recipient, each
//     catching its own error, run SEND_CONCURRENCY-wide. lib/email.ts opens a
//     pool with maxConnections: 3, which a sequential await loop never uses, so
//     matching that number here is roughly a threefold speedup for free;
//   - a wall-clock budget, like sendChapterBroadcast(): stop with time to spare
//     before the function timeout and report what is left, rather than dying
//     mid-send with no record of how far it got.
//
// So a realistic chapter goes out in one press, and a pathologically large one
// still degrades safely into an accurate `remaining` instead of a timeout. The
// scheduling itself lives in lib/bulk-send.ts, shared with the acceptance and
// rejection sends.

export async function sendRsvpEmails(chapterId: string): Promise<
  | { error: string }
  | { success: true; sent: number; remaining: number; failed: string[] }
> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const adminClient = createAdminClient();

  const { data: accepted, error } = await adminClient
    .from("applications")
    .select(
      "id, email, first_name, chapters!inner(name, city, country, date, date_end), application_rsvps(application_id)"
    )
    .eq("chapter_id", chapterId)
    .eq("status", "accepted")
    .limit(QUERY_LIMITS.applicationsPerChapter);

  if (error) return { error: "Could not load accepted applications." };

  const pending = (accepted ?? []).filter((a) => {
    const rsvp = a.application_rsvps;
    return Array.isArray(rsvp) ? rsvp.length === 0 : !rsvp;
  });

  if (pending.length === 0) {
    return { success: true, sent: 0, remaining: 0, failed: [] };
  }

  let sent = 0;
  const failed: string[] = [];

  // The budget is enforced before the insert below: a recipient it did not
  // reach must leave no row behind, or the next press would consider them
  // already asked and they would never be mailed.
  const { skipped } = await runBudgetedConcurrent(pending, async (app) => {
    const chapter = (Array.isArray(app.chapters) ? app.chapters[0] : app.chapters) as Record<
      string,
      unknown
    >;

    // Insert first so the token comes from the column default, then mail it.
    const { data: inserted, error: insertErr } = await adminClient
      .from("application_rsvps")
      .insert({ application_id: app.id })
      .select("rsvp_token")
      .single();

    if (insertErr || !inserted?.rsvp_token) {
      failed.push(app.email as string);
      return;
    }

    try {
      const html = await renderRsvpRequestEmail({
        firstName: app.first_name as string,
        chapterName: chapter.name as string,
        chapterCity: `${chapter.city}, ${chapter.country}`,
        chapterDate: formatDateRange(chapter.date as string, chapter.date_end as string | null),
        rsvpToken: inserted.rsvp_token as string,
        deadline: formatRsvpDeadline(new Date()),
      });

      await sendEmail({
        to: app.email as string,
        subject: `One click left: secure your spot at ${chapter.name}`,
        html,
        skipRateLimit: true,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send RSVP email to ${app.email}:`, err);
      // Roll the row back so this applicant is picked up again on the next
      // press instead of being silently marked as asked.
      await adminClient.from("application_rsvps").delete().eq("application_id", app.id);
      failed.push(app.email as string);
    }
  });

  if (sent > 0) {
    logEvent({
      action: "application.rsvp_requested",
      entityType: "chapter",
      entityId: chapterId,
      actorId: await getActingUserId(),
      actorType: "admin",
      delta: { rsvp_emails: { sent, failed: failed.length, skipped: skipped.length } },
    });
  }

  return { success: true, sent, remaining: skipped.length, failed };
}
