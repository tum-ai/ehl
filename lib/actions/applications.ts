"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdminAction } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import {
  renderApplicationReceivedEmail,
  renderApplicationAcceptedEmail,
  renderApplicationRejectedEmail,
} from "@/lib/emails/render";
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
  const rl = await checkRateLimit(applicationLimiter, ip);
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

  // Handle CV upload (Google Drive)
  let cvUrl: string | null = null;
  const cvFile = formData.get("cv") as File | null;
  if (cvFile && cvFile.size > 0) {
    if (cvFile.size > 20 * 1024 * 1024) {
      return { error: "CV file must be under 20MB." };
    }
    const ext = cvFile.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf") {
      return { error: "CV must be a PDF file." };
    }
    try {
      const chapterName = (chapter.name as string).replace(/[^a-zA-Z0-9 ]/g, "");
      const fileName = `${lastName}_${firstName}_CV.pdf`;
      const result = await uploadFile(
        cvFile,
        fileName,
        "application/pdf",
        ["CVs", chapterName]
      );
      cvUrl = result.fileId;
    } catch (err) {
      console.error("CV upload error:", err);
    }
  }

  // Insert application
  const { error: insertError } = await adminClient.from("applications").insert({
    chapter_id: chapterId,
    email,
    first_name: firstName,
    last_name: lastName,
    form_data: formDataJson,
    cv_url: cvUrl,
    existing_team_id: existingTeamId,
    team_members: teamMembers,
    consent_attendance: formData.get("consentAttendance") === "true",
    consent_privacy: formData.get("consentPrivacy") === "true",
    consent_newsletter: formData.get("consentNewsletter") === "true",
    consent_recruiting: formData.get("consentRecruiting") === "true",
    consent_media: formData.get("consentMedia") === "true",
    consent_ip_transfer: formData.get("consentIpTransfer") === "true",
    consent_sponsor_data: formData.get("consentSponsorData") === "true",
  });

  if (insertError) {
    console.error("Application insert error:", insertError);
    return { error: "Failed to submit application. Please try again." };
  }

  logEvent({
    action: "application.submitted",
    entityType: "application",
    entityId: chapterId,
    actorType: "participant",
    delta: { created: { email, chapter_id: chapterId } },
  });

  // Send confirmation email (fire and forget)
  const dateStr = formatDateRange(chapter.date, chapter.date_end);
  renderApplicationReceivedEmail({
    firstName,
    chapterName: chapter.name as string,
    chapterCity: `${chapter.city}, ${chapter.country}`,
    chapterDate: dateStr,
  }).then((html) =>
    sendEmail({
      to: email,
      subject: `Application received: ${chapter.name}`,
      html,
    })
  ).catch((err) => console.error("Failed to send confirmation email:", err));

  return { success: true };
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
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Check if status is locked (email already sent)
  const { data: app } = await adminClient
    .from("applications")
    .select("acceptance_email_sent_at, rejection_email_sent_at, status")
    .eq("id", applicationId)
    .single();

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
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Filter out locked applications (email already sent)
  const { data: apps } = await adminClient
    .from("applications")
    .select("id, acceptance_email_sent_at, rejection_email_sent_at")
    .in("id", applicationIds);

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
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const { data: applications } = await adminClient
    .from("applications")
    .select("*, chapters!inner(name, city, country, date, date_end, slug)")
    .in("id", applicationIds)
    .eq("status", "accepted");

  if (!applications || applications.length === 0) {
    return { error: "No accepted applications found." };
  }

  let sent = 0;
  for (const app of applications) {
    // Skip if already emailed
    if (app.acceptance_email_sent_at) continue;

    const chapter = app.chapters as Record<string, unknown>;
    const dateStr = formatDateRange(
      chapter.date as string,
      chapter.date_end as string | null
    );

    // Generate QR code as PNG buffer for CID attachment
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
    });

    try {
      await sendEmail({
        to: app.email as string,
        subject: `You're in! Accepted for ${chapter.name}`,
        html,
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
    }
  }

  return { success: true, sent };
}

// ─── Admin: Send rejection emails ──────────────────────────

export async function sendRejectionEmails(applicationIds: string[]) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const { data: applications } = await adminClient
    .from("applications")
    .select("*, chapters!inner(name, city, country, date, date_end)")
    .in("id", applicationIds)
    .eq("status", "rejected");

  if (!applications || applications.length === 0) {
    return { error: "No rejected applications found." };
  }

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

// ─── Admin: Send all pending emails (acceptance + rejection) ─

export async function sendBulkEmails(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
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

  let acceptedSent = 0;
  let rejectedSent = 0;

  if (acceptedIds.length > 0) {
    const result = await sendAcceptanceEmails(acceptedIds);
    acceptedSent = result.sent ?? 0;
  }

  if (rejectedIds.length > 0) {
    const result = await sendRejectionEmails(rejectedIds);
    rejectedSent = result.sent ?? 0;
  }

  return {
    success: true,
    acceptedSent,
    rejectedSent,
  };
}

// ─── Admin: QR Check-in ─────────────────────────────────────

export async function checkInApplication(checkInToken: string, adminUserId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const { data: application } = await adminClient
    .from("applications")
    .select("id, status, first_name, last_name, email")
    .eq("check_in_token", checkInToken)
    .single();

  if (!application) {
    return { error: "Invalid QR code. No application found." };
  }

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
