"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdminAction, requireChapterAdminAction } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import {
  renderApplicationReceivedEmail,
  renderApplicationAcceptedEmail,
  renderApplicationRejectedEmail,
  renderApplicationCancelledEmail,
} from "@/lib/emails/render";
import { getSession } from "@/lib/actions/auth";
import { toApplicationNote } from "@/lib/queries/mappers";
import { formatDateRange } from "@/lib/utils";
import type { ApplicationStatus, ApplicationTeamMember } from "@/lib/types";
import { uploadFile } from "@/lib/gdrive";
import QRCode from "qrcode";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, applicationLimiter, apiLimiter } from "@/lib/ratelimit";
import { logEvent } from "@/lib/event-log";

// ─── Submit application (public) ─────────────────────────────

export async function submitApplication(formData: FormData) {
  const chapterId = formData.get("chapterId") as string;
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!chapterId || !firstName || !lastName || !email) {
    return { error: "First name, last name, and email are required." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(applicationLimiter, ip, "application");
  if (rl.limited) return { error: rl.error! };

  const adminClient = createAdminClient();

  // Verify chapter is accepting applications
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id, name, city, country, date, date_end, slug, status")
    .eq("id", chapterId)
    .single();

  if (!chapter || chapter.status !== "applications_open") {
    return { error: "Applications are not currently open for this match." };
  }

  // Check for duplicate application
  const { data: existing } = await adminClient
    .from("applications")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("email", email)
    .single();

  if (existing) {
    return { error: "You have already applied for this match." };
  }

  // Build form_data JSONB
  const formDataJson = {
    dateOfBirth: formData.get("dateOfBirth") || null,
    gender: formData.get("gender") || null,
    nationality: formData.get("nationality") || null,
    city: formData.get("locationCity") || null,
    country: formData.get("locationCountry") || null,
    currentlyStudying: formData.get("currentlyStudying") === "true",
    university: formData.get("university") || null,
    degree: formData.get("degree") || null,
    fieldOfStudy: formData.get("fieldOfStudy") || null,
    graduationDate: formData.get("graduationDate") || null,
    hasProgrammingSkills: formData.get("hasProgrammingSkills") === "true",
    isTumaiMember: formData.get("isTumaiMember") === "true",
    hackathonExperience: formData.get("hackathonExperience") || "",
    linkedIn: formData.get("linkedIn") || null,
    github: formData.get("github") || null,
    website: formData.get("website") || null,
    hasTeam: formData.get("hasTeam") === "true",
    dietaryRestrictions: formData.get("dietaryRestrictions") || "None",
    dietaryRestrictionsOther: formData.get("dietaryRestrictionsOther") || null,
    tshirtCut: formData.get("tshirtCut") || "men's",
    tshirtSize: formData.get("tshirtSize") || "M",
    discoverySource: JSON.parse((formData.get("discoverySource") as string) || "[]"),
    discoverySourceOther: formData.get("discoverySourceOther") || null,
    additionalNotes: formData.get("additionalNotes") || null,
  };

  // Parse team members
  const teamMembers: ApplicationTeamMember[] = [];
  for (let i = 0; i < 4; i++) {
    const memberFirst = formData.get(`teamMemberFirstName${i}`) as string;
    const memberLast = formData.get(`teamMemberLastName${i}`) as string;
    const memberEmail = formData.get(`teamMemberEmail${i}`) as string;
    if (memberFirst && memberLast && memberEmail) {
      teamMembers.push({
        firstName: memberFirst.trim(),
        lastName: memberLast.trim(),
        email: memberEmail.trim().toLowerCase(),
      });
    }
  }

  // Check for existing team (by email in team_members + profiles)
  let existingTeamId: string | null = formData.get("existingTeamId") as string || null;

  if (!existingTeamId) {
    const { data: profileRow } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (profileRow) {
      const { data: memberRecord } = await adminClient
        .from("team_members")
        .select("team_id")
        .eq("user_id", profileRow.id as string)
        .limit(1)
        .single();

      existingTeamId = (memberRecord?.team_id as string) ?? null;
    }
  }

  // Validate the CV before anything is written. The upload itself happens
  // AFTER the application row is inserted, so a Drive outage or hang can
  // never lose an application.
  const cvFile = formData.get("cv") as File | null;
  const hasCv = !!cvFile && cvFile.size > 0;
  if (hasCv) {
    if (cvFile!.size > 10 * 1024 * 1024) {
      return { error: "CV file must be under 10MB." };
    }
    const ext = cvFile!.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf") {
      return { error: "CV must be a PDF file." };
    }
  }

  // Insert application first (without CV), so the application is saved even
  // if the CV upload later fails.
  const { data: inserted, error: insertError } = await adminClient
    .from("applications")
    .insert({
      chapter_id: chapterId,
      email,
      first_name: firstName,
      last_name: lastName,
      form_data: formDataJson,
      cv_url: null,
      existing_team_id: existingTeamId,
      team_members: teamMembers,
      consent_attendance: formData.get("consentAttendance") === "true",
      consent_privacy: formData.get("consentPrivacy") === "true",
      consent_newsletter: formData.get("consentNewsletter") === "true",
      consent_recruiting: formData.get("consentRecruiting") === "true",
      consent_media: formData.get("consentMedia") === "true",
      consent_ip_transfer: formData.get("consentIpTransfer") === "true",
      consent_sponsor_data: formData.get("consentSponsorData") === "true",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    // Unique violation: same email already applied to this chapter.
    if (insertError?.code === "23505") {
      return { error: "You have already applied to this match with this email." };
    }
    console.error("Application insert error:", insertError);
    return { error: "Failed to submit application. Please try again." };
  }

  // Upload the CV and attach it to the saved application. A failure here does
  // not lose the application; the user is told the CV part failed.
  let cvUploadFailed = false;
  if (hasCv) {
    try {
      const chapterName = (chapter.name as string).replace(/[^a-zA-Z0-9 ]/g, "");
      const fileName = `${lastName}_${firstName}_CV.pdf`;
      const result = await uploadFile(
        cvFile!,
        fileName,
        "application/pdf",
        ["CVs", chapterName]
      );
      await adminClient
        .from("applications")
        .update({ cv_url: result.fileId })
        .eq("id", inserted.id);
    } catch (err) {
      console.error("CV upload error:", err);
      cvUploadFailed = true;
    }
  }

  logEvent({
    action: "application.submitted",
    entityType: "application",
    entityId: chapterId,
    actorType: "participant",
    delta: { created: { email, chapter_id: chapterId } },
  });

  // Send confirmation email after the response; a floating promise would be
  // dropped when the serverless instance freezes.
  const dateStr = formatDateRange(chapter.date, chapter.date_end);
  sendEmailAfterResponse(`application confirmation to ${email}`, async () => {
    const html = await renderApplicationReceivedEmail({
      firstName,
      chapterName: chapter.name as string,
      chapterCity: `${chapter.city}, ${chapter.country}`,
      chapterDate: dateStr,
    });
    await sendEmail({
      to: email,
      subject: `Application received: ${chapter.name}`,
      html,
    });
  });

  return { success: true, cvUploadFailed };
}

// ─── Check if email is linked to an existing account ─────────
// Returns true/false only, never reveals personal data (GDPR safe)
// Rate limited to prevent email enumeration

export async function checkEmailHasAccount(email: string): Promise<boolean> {
  if (!email) return false;

  // Rate limit to prevent enumeration
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(apiLimiter, `email-check:${ip}`);
  if (rl.limited) return false; // Silently deny when rate limited

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .limit(1)
    .single();

  return !!data;
}

// ─── Get authenticated user's previous application data ──────
// Only callable with a valid session (server action checks auth)

export async function getMyPreviousApplication() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const adminClient = createAdminClient();

  // Get profile email
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email, name")
    .eq("id", user.id)
    .single();

  if (!profile?.email) return null;

  // Find most recent application
  const { data } = await adminClient
    .from("applications")
    .select("first_name, last_name, form_data, team_members")
    .eq("email", profile.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    firstName: data.first_name as string,
    lastName: data.last_name as string,
    email: profile.email as string,
    formData: data.form_data as Record<string, unknown>,
    teamMembers: data.team_members as ApplicationTeamMember[],
  };
}

// ─── Team lookup ─────────────────────────────────────────────
// Rate limited to prevent enumeration of team membership

export async function lookupExistingTeam(email: string) {
  if (!email) return null;

  // Rate limit to prevent enumeration
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(apiLimiter, `team-lookup:${ip}`);
  if (rl.limited) return null; // Silently deny when rate limited

  const adminClient = createAdminClient();

  // Find profile by email
  const { data: profile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (!profile) return null;

  // Find team membership
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("user_id", profile.id)
    .limit(1)
    .single();

  if (!membership) return null;

  // Get team name
  const { data: team } = await adminClient
    .from("teams")
    .select("id, name")
    .eq("id", membership.team_id)
    .single();

  if (!team) return null;

  return { teamId: team.id as string, teamName: team.name as string };
}

// ─── Admin: Delete application ─────────────────────────────────

export async function deleteApplication(applicationId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Fetch application data for the log before deleting
  const { data: app, error: fetchError } = await adminClient
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (fetchError || !app) {
    return { error: "Application not found." };
  }

  // Delete (screening_scores cascade, but team_members link via application doesn't exist)
  const { error } = await adminClient
    .from("applications")
    .delete()
    .eq("id", applicationId);

  if (error) {
    return { error: error.message };
  }

  logEvent({
    action: "application.deleted",
    entityType: "application",
    entityId: applicationId,
    actorType: "admin",
    delta: { deleted: { application_id: applicationId } },
  });

  return { success: true };
}

// ─── Admin: Update application status ────────────────────────

export async function updateApplicationStatus(
  applicationId: string,
  status: ApplicationStatus
) {
  const adminClient = createAdminClient();

  // Check if status is locked (email already sent)
  const { data: app } = await adminClient
    .from("applications")
    .select("acceptance_email_sent_at, rejection_email_sent_at, status, chapter_id")
    .eq("id", applicationId)
    .single();

  const authErr = await requireChapterAdminAction(app?.chapter_id as string);
  if (authErr) return { error: authErr };

  if (app?.acceptance_email_sent_at || app?.rejection_email_sent_at) {
    return { error: "Cannot change status after email has been sent." };
  }

  const previousStatus = app?.status as string | undefined;

  const { error } = await adminClient
    .from("applications")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", applicationId);

  if (error) {
    return { error: error.message };
  }

  logEvent({
    action: "application.status_changed",
    entityType: "application",
    entityId: applicationId,
    actorType: "admin",
    delta: { status: { from: previousStatus ?? "unknown", to: status } },
  });

  return { success: true };
}

export async function bulkUpdateApplicationStatus(
  applicationIds: string[],
  status: ApplicationStatus
) {
  const adminClient = createAdminClient();

  // Filter out locked applications (email already sent)
  const { data: apps } = await adminClient
    .from("applications")
    .select("id, acceptance_email_sent_at, rejection_email_sent_at, chapter_id")
    .in("id", applicationIds);

  const chapterId = (apps ?? [])[0]?.chapter_id as string | undefined;
  const authErr = await requireChapterAdminAction(chapterId ?? "");
  if (authErr) return { error: authErr };

  // Reject if any application belongs to a different chapter.
  const crossChapter = (apps ?? []).some((a) => a.chapter_id !== chapterId);
  if (crossChapter) return { error: "All applications must belong to the same chapter." };

  const actionableIds = (apps ?? [])
    .filter((a) => !a.acceptance_email_sent_at && !a.rejection_email_sent_at)
    .map((a) => a.id as string);

  if (actionableIds.length === 0) {
    return { error: "All selected applications are locked (email already sent)." };
  }

  const { error } = await adminClient
    .from("applications")
    .update({ status, updated_at: new Date().toISOString() })
    .in("id", actionableIds);

  if (error) {
    return { error: error.message };
  }

  logEvent({
    action: "application.bulk_status_changed",
    entityType: "application",
    entityId: "bulk",
    actorType: "admin",
    delta: { updated: { count: applicationIds.length, to_status: status } },
  });

  return { success: true };
}

// ─── Admin: Send acceptance emails with QR codes ─────────────

export async function sendAcceptanceEmails(applicationIds: string[]) {
  const adminClient = createAdminClient();

  const { data: applications } = await adminClient
    .from("applications")
    .select("*, chapters!inner(name, city, country, date, date_end, slug)")
    .in("id", applicationIds)
    .eq("status", "accepted");

  const chapterId = (applications ?? [])[0]?.chapter_id as string | undefined;
  const authErr = await requireChapterAdminAction(chapterId ?? "");
  if (authErr) return { error: authErr };

  if (!applications || applications.length === 0) {
    return { error: "No accepted applications found." };
  }

  const crossChapter = applications.some((a) => a.chapter_id !== chapterId);
  if (crossChapter) return { error: "All applications must belong to the same chapter." };

  let sent = 0;
  const failed: string[] = [];
  for (const app of applications) {
    // Skip if already emailed
    if (app.acceptance_email_sent_at) continue;

    const chapter = app.chapters as Record<string, unknown>;
    const dateStr = formatDateRange(
      chapter.date as string,
      chapter.date_end as string | null
    );

    try {
      // QR generation and render are inside the try so one bad row (e.g. a
      // null check_in_token) fails only that applicant, not the whole batch.
      const qrCodeBuffer = await QRCode.toBuffer(app.check_in_token as string, {
        width: 400,
        margin: 1,
        color: { dark: "#0B0B1A", light: "#FFFFFF" },
      });

      const html = await renderApplicationAcceptedEmail({
        firstName: app.first_name as string,
        chapterName: chapter.name as string,
        chapterCity: `${chapter.city}, ${chapter.country}`,
        chapterDate: dateStr,
        chapterSlug: chapter.slug as string,
        checkInToken: app.check_in_token as string,
      });

      await sendEmail({
        to: app.email as string,
        subject: `You're in! Accepted for ${chapter.name}`,
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
      await adminClient
        .from("applications")
        .update({ acceptance_email_sent_at: new Date().toISOString() })
        .eq("id", app.id);
      sent++;
    } catch (err) {
      console.error(`Failed to send acceptance email to ${app.email}:`, err);
      failed.push(app.email as string);
    }
  }

  if (failed.length > 0) {
    return { success: true, sent, error: `Failed to send to: ${failed.join(", ")}` };
  }
  return { success: true, sent };
}

// ─── Admin: Send rejection emails ──────────────────────────

export async function sendRejectionEmails(applicationIds: string[]) {
  const adminClient = createAdminClient();

  const { data: applications } = await adminClient
    .from("applications")
    .select("*, chapters!inner(name, city, country, date, date_end)")
    .in("id", applicationIds)
    .eq("status", "rejected");

  const chapterId = (applications ?? [])[0]?.chapter_id as string | undefined;
  const authErr = await requireChapterAdminAction(chapterId ?? "");
  if (authErr) return { error: authErr };

  if (!applications || applications.length === 0) {
    return { error: "No rejected applications found." };
  }

  const crossChapter = applications.some((a) => a.chapter_id !== chapterId);
  if (crossChapter) return { error: "All applications must belong to the same chapter." };

  let sent = 0;
  for (const app of applications) {
    if (app.rejection_email_sent_at) continue;

    const chapter = app.chapters as Record<string, unknown>;
    const dateStr = formatDateRange(
      chapter.date as string,
      chapter.date_end as string | null
    );

    const html = await renderApplicationRejectedEmail({
      firstName: app.first_name as string,
      chapterName: chapter.name as string,
      chapterCity: `${chapter.city}, ${chapter.country}`,
      chapterDate: dateStr,
    });

    try {
      await sendEmail({
        to: app.email as string,
        subject: `Application update: ${chapter.name}`,
        html,
        skipRateLimit: true,
      });
      await adminClient
        .from("applications")
        .update({ rejection_email_sent_at: new Date().toISOString() })
        .eq("id", app.id);
      sent++;
    } catch (err) {
      console.error(`Failed to send rejection email to ${app.email}:`, err);
    }
  }

  return { success: true, sent };
}

// ─── Admin: Cancel an accepted applicant ─────────────────────

// Unlike updateApplicationStatus, cancelling is allowed AFTER the acceptance
// email has been sent: the whole point is to handle an accepted (and emailed)
// person who can no longer attend. The reason is stored on the application and
// written as the first note, and the transition is recorded in the event_log.
export async function cancelApplication(
  applicationId: string,
  reason: string,
  sendEmailToApplicant = false
) {
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { error: "A reason is required to cancel an applicant." };
  }

  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("applications")
    .select("*, chapters!inner(name, city, country, date, date_end)")
    .eq("id", applicationId)
    .single();

  if (!app) {
    return { error: "Application not found." };
  }

  const authErr = await requireChapterAdminAction(app.chapter_id as string);
  if (authErr) return { error: authErr };

  if (app.status === "cancelled") {
    return { error: "This applicant is already cancelled." };
  }

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;
  const actorEmail = session?.profile?.email ?? null;
  const previousStatus = app.status as string;
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("applications")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: actorId,
      cancel_reason: trimmedReason,
      updated_at: now,
    })
    .eq("id", applicationId);

  if (error) {
    return { error: error.message };
  }

  // The cancel reason becomes the first entry in the notes history.
  await adminClient.from("application_notes").insert({
    application_id: applicationId,
    author_id: actorId,
    author_email: actorEmail,
    body: `Cancelled (was ${previousStatus}): ${trimmedReason}`,
  });

  logEvent({
    action: "application.cancelled",
    entityType: "application",
    entityId: applicationId,
    actorId,
    actorType: "admin",
    delta: {
      status: { from: previousStatus, to: "cancelled" },
      reason: trimmedReason,
      email_sent: sendEmailToApplicant,
    },
  });

  if (sendEmailToApplicant) {
    const chapter = app.chapters as Record<string, unknown>;
    const dateStr = formatDateRange(
      chapter.date as string,
      chapter.date_end as string | null
    );
    sendEmailAfterResponse("application-cancelled", async () => {
      const html = await renderApplicationCancelledEmail({
        firstName: app.first_name as string,
        chapterName: chapter.name as string,
        chapterCity: `${chapter.city}, ${chapter.country}`,
        chapterDate: dateStr,
      });
      await sendEmail({
        to: app.email as string,
        subject: `Your spot for ${chapter.name} has been cancelled`,
        html,
        skipRateLimit: true,
      });
    });
  }

  return { success: true };
}

// Reverse a cancellation (e.g. cancelled by mistake). Restores the applicant to
// "accepted" and records the reversal in the notes history and event_log.
export async function uncancelApplication(applicationId: string, reason?: string) {
  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("applications")
    .select("status, chapter_id")
    .eq("id", applicationId)
    .single();

  if (!app) {
    return { error: "Application not found." };
  }

  const authErr = await requireChapterAdminAction(app.chapter_id as string);
  if (authErr) return { error: authErr };

  if (app.status !== "cancelled") {
    return { error: "This applicant is not cancelled." };
  }

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;
  const actorEmail = session?.profile?.email ?? null;
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("applications")
    .update({
      status: "accepted",
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      updated_at: now,
    })
    .eq("id", applicationId);

  if (error) {
    return { error: error.message };
  }

  const trimmedReason = reason?.trim();
  await adminClient.from("application_notes").insert({
    application_id: applicationId,
    author_id: actorId,
    author_email: actorEmail,
    body: trimmedReason
      ? `Cancellation reversed (back to accepted): ${trimmedReason}`
      : "Cancellation reversed (back to accepted).",
  });

  logEvent({
    action: "application.uncancelled",
    entityType: "application",
    entityId: applicationId,
    actorId,
    actorType: "admin",
    delta: { status: { from: "cancelled", to: "accepted" } },
  });

  return { success: true };
}

// ─── Admin: Application notes (append-only history) ──────────

export async function addApplicationNote(applicationId: string, body: string) {
  const trimmed = body?.trim();
  if (!trimmed) {
    return { error: "Note cannot be empty." };
  }

  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("applications")
    .select("chapter_id")
    .eq("id", applicationId)
    .single();

  if (!app) {
    return { error: "Application not found." };
  }

  const authErr = await requireChapterAdminAction(app.chapter_id as string);
  if (authErr) return { error: authErr };

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;
  const actorEmail = session?.profile?.email ?? null;

  const { error } = await adminClient.from("application_notes").insert({
    application_id: applicationId,
    author_id: actorId,
    author_email: actorEmail,
    body: trimmed,
  });

  if (error) {
    return { error: error.message };
  }

  logEvent({
    action: "application.note_added",
    entityType: "application",
    entityId: applicationId,
    actorId,
    actorType: "admin",
    delta: { note: { added: true } },
  });

  return { success: true };
}

export async function getApplicationNotes(applicationId: string) {
  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("applications")
    .select("chapter_id")
    .eq("id", applicationId)
    .single();

  if (!app) {
    return { error: "Application not found." };
  }

  const authErr = await requireChapterAdminAction(app.chapter_id as string);
  if (authErr) return { error: authErr };

  const { data, error } = await adminClient
    .from("application_notes")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) {
    return { error: error.message };
  }

  return { notes: (data ?? []).map(toApplicationNote) };
}

// ─── Admin: Send all pending emails (acceptance + rejection) ─

export async function sendBulkEmails(chapterId: string) {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };
  const adminClient = createAdminClient();

  // Get all accepted without acceptance email
  const { data: accepted } = await adminClient
    .from("applications")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("status", "accepted")
    .is("acceptance_email_sent_at", null);

  // Get all rejected without rejection email
  const { data: rejected } = await adminClient
    .from("applications")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("status", "rejected")
    .is("rejection_email_sent_at", null);

  const acceptedIds = (accepted ?? []).map((a) => a.id as string);
  const rejectedIds = (rejected ?? []).map((a) => a.id as string);

  // Cap per invocation so a large pending set (hundreds of applicants) can't
  // exceed the serverless function timeout. Progress is persisted per-applicant
  // (acceptance/rejection_email_sent_at), so the UI re-invokes to send the rest.
  const BATCH = 40;
  const totalPending = acceptedIds.length + rejectedIds.length;

  const acceptedBatch = acceptedIds.slice(0, BATCH);
  const rejectedBatch = rejectedIds.slice(0, Math.max(0, BATCH - acceptedBatch.length));

  let acceptedSent = 0;
  let rejectedSent = 0;

  if (acceptedBatch.length > 0) {
    const result = await sendAcceptanceEmails(acceptedBatch);
    acceptedSent = result.sent ?? 0;
  }

  if (rejectedBatch.length > 0) {
    const result = await sendRejectionEmails(rejectedBatch);
    rejectedSent = result.sent ?? 0;
  }

  const remaining = Math.max(0, totalPending - acceptedBatch.length - rejectedBatch.length);

  return {
    success: true,
    acceptedSent,
    rejectedSent,
    remaining,
  };
}

// ─── Admin: QR Check-in ─────────────────────────────────────

export async function checkInApplication(checkInToken: string, adminUserId: string) {
  const adminClient = createAdminClient();

  const { data: application } = await adminClient
    .from("applications")
    .select("id, status, first_name, last_name, email, chapter_id")
    .eq("check_in_token", checkInToken)
    .single();

  if (!application) {
    return { error: "Invalid QR code. No application found." };
  }

  const authErr = await requireChapterAdminAction(application.chapter_id as string);
  if (authErr) return { error: authErr };

  if (application.status === "checked_in") {
    return {
      error: "Already checked in.",
      name: `${application.first_name} ${application.last_name}`,
    };
  }

  if (application.status !== "accepted") {
    return {
      error: `Cannot check in. Application status: ${application.status}`,
      name: `${application.first_name} ${application.last_name}`,
    };
  }

  const { error } = await adminClient
    .from("applications")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checked_in_by: adminUserId,
    })
    .eq("id", application.id);

  if (error) {
    return { error: "Check-in failed. Please try again." };
  }

  logEvent({
    action: "application.checked_in",
    entityType: "application",
    entityId: application.id as string,
    actorId: adminUserId,
    actorType: "admin",
    delta: { status: { from: "accepted", to: "checked_in" } },
  });

  return {
    success: true,
    name: `${application.first_name} ${application.last_name}`,
    email: application.email as string,
  };
}

// ─── Admin: Search applications for manual check-in ────────

export async function searchApplicationsForCheckIn(
  chapterId: string,
  query: string
) {
  const adminErr = await requireChapterAdminAction(chapterId);
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const trimmed = query.trim();
  if (trimmed.length < 2) return { results: [] };

  // Search by name or email in accepted applications for this chapter
  const { data } = await adminClient
    .from("applications")
    .select("id, first_name, last_name, email, status")
    .eq("chapter_id", chapterId)
    .in("status", ["accepted", "checked_in"])
    .or(`first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`)
    .order("last_name")
    .limit(10);

  return {
    results: (data ?? []).map((a) => ({
      id: a.id as string,
      name: `${a.first_name} ${a.last_name}`,
      email: a.email as string,
      status: a.status as string,
    })),
  };
}

// ─── Admin: Check-in by application ID (manual fallback) ───

export async function checkInApplicationById(
  applicationId: string,
  adminUserId: string
) {
  const adminClient = createAdminClient();

  const { data: application } = await adminClient
    .from("applications")
    .select("id, status, first_name, last_name, email, chapter_id")
    .eq("id", applicationId)
    .single();

  if (!application) {
    return { error: "Application not found." };
  }

  const authErr = await requireChapterAdminAction(application.chapter_id as string);
  if (authErr) return { error: authErr };

  if (application.status === "checked_in") {
    return {
      error: "Already checked in.",
      name: `${application.first_name} ${application.last_name}`,
    };
  }

  if (application.status !== "accepted") {
    return {
      error: `Cannot check in. Application status: ${application.status}`,
      name: `${application.first_name} ${application.last_name}`,
    };
  }

  const { error } = await adminClient
    .from("applications")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checked_in_by: adminUserId,
    })
    .eq("id", application.id);

  if (error) {
    return { error: "Check-in failed. Please try again." };
  }

  logEvent({
    action: "application.checked_in",
    entityType: "application",
    entityId: application.id as string,
    actorId: adminUserId,
    actorType: "admin",
    delta: { status: { from: "accepted", to: "checked_in" }, method: "name_search" },
  });

  return {
    success: true,
    name: `${application.first_name} ${application.last_name}`,
    email: application.email as string,
  };
}
