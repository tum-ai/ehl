import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { renderApplicationAcceptedEmail } from "@/lib/emails/render";
import { getChapterCommunications } from "@/lib/queries";
import { acceptanceEmailSubject } from "@/lib/communications";
import { splitParagraphs } from "@/lib/emails/text-block";
import { formatDateRange } from "@/lib/utils";

/**
 * The acceptance email with the check-in QR code, in ONE place.
 *
 * Two paths accept an applicant and both must produce a byte-identical email:
 * the admin bulk send (lib/actions/applications.ts) and a Grand Finale invitee
 * clicking "I'm in" (lib/actions/finale-invites.ts). This module is deliberately
 * NOT a "use server" file: every export of such a file becomes a callable
 * endpoint, and a sender that takes an application row would then let a client
 * mail arbitrary content to an arbitrary address. Callers are server actions
 * that have already checked who is allowed to do what.
 *
 * `acceptance_email_sent_at` is stamped ONLY after the send resolves, which is
 * what makes the admin's "send pending emails" button a safety net for a failed
 * send here: an unstamped accepted applicant is picked up on the next press.
 */

export interface AcceptanceEmailApplication {
  id: string;
  email: string;
  first_name: string;
  check_in_token: string;
  chapters: {
    name: string;
    city: string;
    country: string;
    date: string;
    date_end: string | null;
    slug: string;
  };
}

export interface AcceptanceEmailCustomisation {
  acceptanceEmailSubject: string | null;
  acceptanceEmailMessage: string | null;
}

/**
 * Renders and sends the acceptance email, then stamps the application.
 * Throws on failure so callers can count it as failed and leave the stamp null.
 */
export async function deliverAcceptanceEmail(
  app: AcceptanceEmailApplication,
  comms: AcceptanceEmailCustomisation
): Promise<void> {
  const chapter = app.chapters;

  // QR generation and render sit inside the caller's try/catch: one bad row
  // (e.g. a null check_in_token) must fail only that applicant.
  const qrCodeBuffer = await QRCode.toBuffer(app.check_in_token, {
    width: 400,
    margin: 1,
    color: { dark: "#0B0B1A", light: "#FFFFFF" },
  });

  const html = await renderApplicationAcceptedEmail({
    firstName: app.first_name,
    chapterName: chapter.name,
    chapterCity: `${chapter.city}, ${chapter.country}`,
    chapterDate: formatDateRange(chapter.date, chapter.date_end),
    chapterSlug: chapter.slug,
    checkInToken: app.check_in_token,
    customMessageParagraphs: comms.acceptanceEmailMessage
      ? splitParagraphs(comms.acceptanceEmailMessage)
      : undefined,
  });

  await sendEmail({
    to: app.email,
    subject: acceptanceEmailSubject(comms.acceptanceEmailSubject, chapter.name),
    html,
    skipRateLimit: true,
    attachments: [
      {
        filename: "qr-code.png",
        content: qrCodeBuffer,
        contentType: "image/png",
        cid: "qr-code",
      },
    ],
  });

  await createAdminClient()
    .from("applications")
    .update({ acceptance_email_sent_at: new Date().toISOString() })
    .eq("id", app.id);
}

/**
 * Loads one application by id and sends its acceptance email. Used by the
 * Finale invite flow, where a single person is accepted at a time.
 *
 * Returns false (never throws) when the row is missing, already emailed, or the
 * send fails: the caller has already recorded the person's answer and must not
 * fail their click over an email problem. An unstamped row stays visible to the
 * admin's "send pending emails" button.
 */
export async function sendAcceptanceEmailForApplication(applicationId: string): Promise<boolean> {
  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("applications")
    .select(
      "id, email, first_name, check_in_token, acceptance_email_sent_at, chapter_id, chapters!inner(name, city, country, date, date_end, slug)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!app || app.acceptance_email_sent_at) return false;

  // PostgREST types an embedded to-one join as an array in some client versions.
  const chapter = (Array.isArray(app.chapters) ? app.chapters[0] : app.chapters) as
    | AcceptanceEmailApplication["chapters"]
    | undefined;
  if (!chapter) return false;

  try {
    const comms = await getChapterCommunications(app.chapter_id as string);
    await deliverAcceptanceEmail(
      {
        id: app.id as string,
        email: app.email as string,
        first_name: app.first_name as string,
        check_in_token: app.check_in_token as string,
        chapters: chapter,
      },
      comms
    );
    return true;
  } catch (err) {
    console.error(`Failed to send acceptance email for application ${applicationId}:`, err);
    return false;
  }
}
