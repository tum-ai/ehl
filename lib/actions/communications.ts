"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireChapterAdminAction } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { sendEmail } from "@/lib/email";
import { renderChapterBroadcastEmail } from "@/lib/emails/render";
import { splitParagraphs } from "@/lib/emails/text-block";
import { sanitizeBroadcastStatuses } from "@/lib/communications";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { logEvent } from "@/lib/event-log";

const MAX_SUBJECT = 200;
const MAX_BODY = 20000;
const MAX_EVENT_INFO = 20000;

// Stop sending this long before the Vercel function timeout (60s on this plan)
// so the audit row is always written. The remaining recipients are reported back.
const SEND_BUDGET_MS = 45000;

/** Empty/whitespace-only string → null, else trimmed value. */
function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ─── Per-chapter email + event-info settings ──────────────────

export async function updateChapterEmailSettings(
  chapterId: string,
  fields: {
    acceptanceSubject?: string | null;
    acceptanceMessage?: string | null;
    eventInfo?: string | null;
  }
) {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  // Only write keys that were actually provided, so a partial save (e.g. just
  // the event info card) never clobbers the other fields.
  const update: Record<string, string | null> = {};
  if ("acceptanceSubject" in fields) {
    const v = normalize(fields.acceptanceSubject);
    if (v && v.length > MAX_SUBJECT) return { error: "Subject is too long." };
    update.acceptance_email_subject = v;
  }
  if ("acceptanceMessage" in fields) {
    const v = normalize(fields.acceptanceMessage);
    if (v && v.length > MAX_BODY) return { error: "Message is too long." };
    update.acceptance_email_message = v;
  }
  if ("eventInfo" in fields) {
    const v = normalize(fields.eventInfo);
    if (v && v.length > MAX_EVENT_INFO) return { error: "Event info is too long." };
    update.event_info = v;
  }

  if (Object.keys(update).length === 0) return { success: true };

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };
  const adminClient = createAdminClient();
  // Upsert: the chapter_communications row is created on first save and only the
  // provided keys are written, so a partial save never clobbers the other fields.
  const { error } = await adminClient
    .from("chapter_communications")
    .upsert(
      {
        chapter_id: chapterId,
        ...update,
        updated_at: new Date().toISOString(),
        updated_by: session.user.id,
      },
      { onConflict: "chapter_id" }
    );
  if (error) return { error: "Failed to save settings." };

  logEvent({
    action: "chapter.email_settings_updated",
    entityType: "chapter",
    entityId: chapterId,
    actorId: session.user.id,
    actorType: "admin",
    delta: { fields: Object.keys(update) },
  });

  return { success: true };
}

// ─── Recipient count preview (composer) ───────────────────────

export async function getBroadcastRecipientCount(
  chapterId: string,
  statusFilter: string[]
) {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const statuses = sanitizeBroadcastStatuses(statusFilter);
  if (statuses.length === 0) return { count: 0 };

  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("chapter_id", chapterId)
    .in("status", statuses);

  return { count: count ?? 0, cap: QUERY_LIMITS.broadcastRecipients };
}

// ─── Send a broadcast to a chapter's applicants ───────────────

export async function sendChapterBroadcast(
  chapterId: string,
  subject: string,
  body: string,
  statusFilter: string[]
) {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  // Resolve the acting admin up front (before any email is sent), so the
  // broadcast's audit row always records who sent it. Abort if we cannot.
  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };

  const cleanSubject = subject?.trim();
  const cleanBody = body?.trim();
  if (!cleanSubject) return { error: "Subject is required." };
  if (!cleanBody) return { error: "Message is required." };
  if (cleanSubject.length > MAX_SUBJECT) return { error: "Subject is too long." };
  if (cleanBody.length > MAX_BODY) return { error: "Message is too long." };

  // Drop rejected/cancelled/pending server-side regardless of what the client
  // sent. If nothing valid remains (e.g. only "rejected" was passed), reject the
  // send rather than silently falling back to a default audience the admin did
  // not choose.
  const statuses = sanitizeBroadcastStatuses(statusFilter);
  if (statuses.length === 0) {
    return { error: "Select at least one valid recipient status." };
  }

  const adminClient = createAdminClient();

  const { data: chapter } = await adminClient
    .from("chapters")
    .select("name, slug")
    .eq("id", chapterId)
    .single();
  if (!chapter) return { error: "Chapter not found." };

  // Cap recipients so the synchronous send loop stays within the Vercel function
  // timeout. Anyone beyond the cap is folded into `remaining` below so the admin
  // sees the send was truncated (composer also shows a LimitBanner).
  const cap = QUERY_LIMITS.broadcastRecipients;
  const { data: recipients, count: totalMatching } = await adminClient
    .from("applications")
    .select("email, first_name", { count: "exact" })
    .eq("chapter_id", chapterId)
    .in("status", statuses)
    .limit(cap);

  const list = recipients ?? [];
  if (list.length === 0) {
    return { error: "No applicants match the selected statuses." };
  }
  // Recipients matching the filter but not fetched because of the cap.
  const cappedOut = Math.max(0, (totalMatching ?? list.length) - list.length);

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";
  const paragraphs = splitParagraphs(cleanBody);
  const html = await renderChapterBroadcastEmail({
    subject: cleanSubject,
    paragraphs,
    chapterName: chapter.name as string,
    ctaUrl: `${baseUrl}/event/${chapter.slug as string}`,
    ctaLabel: "Open Match Hub",
  });

  // Wall-clock budget: stop the loop with time to spare before the Vercel
  // function timeout so the chapter_broadcasts row is always recorded (otherwise
  // a timeout mid-loop would lose the audit record and the admin would not know
  // how many actually went out). Recipients not reached are reported as
  // remaining so the admin can narrow the status filter and resend.
  const deadline = Date.now() + SEND_BUDGET_MS;
  let sent = 0;
  // Recipients not reached: those skipped by the cap, plus any left when the
  // wall-clock budget stops the loop early.
  let remaining = cappedOut;
  const failed: string[] = [];
  for (const r of list) {
    if (Date.now() > deadline) {
      remaining += list.length - sent - failed.length;
      break;
    }
    try {
      await sendEmail({
        to: r.email as string,
        subject: cleanSubject,
        html,
        skipRateLimit: true,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send broadcast to ${r.email}:`, err);
      failed.push(r.email as string);
    }
  }

  const { error: auditError } = await adminClient.from("chapter_broadcasts").insert({
    chapter_id: chapterId,
    subject: cleanSubject,
    body: cleanBody,
    status_filter: statuses,
    sent_by: session.user.id,
    recipient_count: sent,
  });
  // The "audit row per send" guarantee must hold: if emails went out but the
  // audit row failed, surface that rather than silently reporting success.
  if (auditError) {
    console.error("[broadcast] audit insert failed:", auditError.message);
    return {
      error: `Broadcast sent to ${sent} recipient(s), but recording the audit row failed: ${auditError.message}`,
      sent,
    };
  }

  logEvent({
    action: "chapter.broadcast_sent",
    entityType: "chapter",
    entityId: chapterId,
    actorId: session.user.id,
    actorType: "admin",
    delta: { sent, failed: failed.length, remaining, statuses },
  });

  return {
    success: true,
    sent,
    failed: failed.length,
    failedEmails: failed,
    remaining,
  };
}
