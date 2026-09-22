"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  requireAdminAction,
  requireChapterAdminAction,
  getActingUserId,
} from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import {
  renderApplicationReceivedEmail,
  renderVerificationCodeEmail,
  renderApplicationRejectedEmail,
  renderApplicationCancelledEmail,
} from "@/lib/emails/render";
import { getSession } from "@/lib/actions/auth";
import { getChapterCommunications } from "@/lib/queries";
import { getCurrentMembership } from "@/lib/team-membership";
import { MIN_CHALLENGE_ROSTER } from "@/lib/config/limits";
import { formatDateRange } from "@/lib/utils";
import type { ApplicationStatus, ApplicationTeamMember } from "@/lib/types";
import { buildApplicationInsert } from "@/lib/applications-shared";
import {
  deliverAcceptanceEmail,
  type AcceptanceEmailApplication,
} from "@/lib/acceptance-email";
import { validateCv, attachCv } from "@/lib/application-cv";
import {
  encryptPassword,
  decryptPassword,
  generateVerificationCode,
} from "@/lib/crypto";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, applicationLimiter, apiLimiter } from "@/lib/ratelimit";
import { runBudgetedConcurrent, EMAIL_SEND_BUDGET_MS } from "@/lib/bulk-send";
import { logEvent } from "@/lib/event-log";

// ─── Apply (public): email-verified, creates the account ─────
//
// Applying to a chapter is a full EHL registration in one go. The applicant's
// email is proven BEFORE anything is written, reusing the registration flow's
// verification code as the spam gate, so a bot can no longer file applications
// (or, now, create accounts) for an address it does not control.
//
//   startApplication    validates the whole form, then either submits at once
//                       (signed in: the session already proves the email) or
//                       emails a 6-digit code and returns a verificationId.
//   confirmApplication  checks the code, then creates the account (or reuses the
//                       existing one for that email) and saves the application.
//
// The client keeps the form mounted between the two steps and sends it AGAIN
// with the code. That is how the CV reaches step two: a File is not JSON, so it
// cannot ride along in verification_codes.metadata, and storing the rest of the
// form there would copy personal data into a second table. The metadata holds
// only what the code step owns: the chapter, the email, and (for a new account)
// the encrypted password. The email and chapter are read from that record, never
// from the resubmitted form, so a verified code cannot be spent on another
// address or another chapter.

const APPLICATION_CODE_TTL_MS = 15 * 60 * 1000;
const APPLICATION_CODE_MAX_ATTEMPTS = 5;

type ApplyChapter = {
  id: string;
  name: string;
  city: string;
  country: string;
  date: string;
  date_end: string | null;
  status: string;
  require_cv: boolean | null;
  require_motivation: boolean | null;
};

type ApplyResult =
  | { error: string }
  | { verificationId: string; email: string }
  | { success: true; cvUploadFailed: boolean; signedIn: boolean };

async function loadOpenChapter(
  adminClient: ReturnType<typeof createAdminClient>,
  chapterId: string
): Promise<ApplyChapter | null> {
  const { data: chapter } = await adminClient
    .from("chapters")
    .select(
      "id, name, city, country, date, date_end, status, require_cv, require_motivation"
    )
    .eq("id", chapterId)
    .single();
  if (!chapter || chapter.status !== "applications_open") return null;
  return chapter as ApplyChapter;
}

// Everything about the form that can be refused, checked in both steps: step one
// so the applicant hears about a missing field before a code is sent, step two
// because the form is resubmitted and a non-browser caller can change it.
// Per-chapter requirements (00064) come from the chapter row, never the client.
async function validateApplicationForm(
  adminClient: ReturnType<typeof createAdminClient>,
  formData: FormData,
  chapter: ApplyChapter,
  email: string
): Promise<{ error: string } | { cvFile: File | null }> {
  const { data: existing } = await adminClient
    .from("applications")
    .select("id")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return { error: "You have already applied for this match." };
  }

  const cv = validateCv(formData);
  if ("error" in cv) return cv;

  if (chapter.require_motivation) {
    const motivation = (formData.get("motivation") as string)?.trim();
    if (!motivation) {
      return { error: "Please answer the motivation question." };
    }
  }
  if (chapter.require_cv && !cv.cvFile) {
    return { error: "A CV (PDF) is required for this match." };
  }
  return cv;
}

// Inserts the application for a PROVEN identity (a session, or a verified code)
// and runs the post-insert side effects. user_id is set explicitly here; the
// 00069 trigger would also fill it from the email, but this path knows the id.
async function saveApplication(
  adminClient: ReturnType<typeof createAdminClient>,
  opts: {
    formData: FormData;
    chapter: ApplyChapter;
    email: string;
    firstName: string;
    lastName: string;
    userId: string;
    cvFile: File | null;
  }
): Promise<{ error: string } | { cvUploadFailed: boolean }> {
  const { formData, chapter, email, firstName, lastName, userId, cvFile } = opts;

  // The applicant's CURRENT team, derived from the proven account. Never taken
  // from the form: a client-supplied team id would let anyone attach their
  // application to a team they are not on. A brand-new account has none.
  const membership = await getCurrentMembership(adminClient, userId);

  const { data: inserted, error: insertError } = await adminClient
    .from("applications")
    .insert({
      ...buildApplicationInsert(formData, {
        chapterId: chapter.id,
        firstName,
        lastName,
        email,
      }),
      user_id: userId,
      existing_team_id: membership?.teamId ?? null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return { error: "You have already applied to this match with this email." };
    }
    console.error("Application insert error:", insertError);
    return { error: "Failed to submit application. Please try again." };
  }

  const { cvUploadFailed } = cvFile
    ? await attachCv(adminClient, {
        applicationId: inserted.id as string,
        cvFile,
        chapterName: chapter.name,
        firstName,
        lastName,
      })
    : { cvUploadFailed: false };

  logEvent({
    action: "application.submitted",
    entityType: "application",
    entityId: inserted.id as string,
    actorId: userId,
    actorType: "participant",
    delta: { created: { email, chapter_id: chapter.id } },
  });

  // Sent only now that the application exists. Deferred: a floating promise
  // would be dropped when the serverless instance freezes.
  const dateStr = formatDateRange(chapter.date, chapter.date_end);
  sendEmailAfterResponse(`application confirmation to ${email}`, async () => {
    const html = await renderApplicationReceivedEmail({
      firstName,
      chapterName: chapter.name,
      chapterCity: `${chapter.city}, ${chapter.country}`,
      chapterDate: dateStr,
    });
    await sendEmail({
      to: email,
      subject: `Application received: ${chapter.name}`,
      html,
    });
  });

  return { cvUploadFailed };
}

export async function startApplication(formData: FormData): Promise<ApplyResult> {
  const chapterId = formData.get("chapterId") as string;
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const password = (formData.get("password") as string) ?? "";
  const passwordConfirm = (formData.get("passwordConfirm") as string) ?? "";
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  // A signed-in applicant always applies as their own account: the session is
  // the proof of the email, so the form's email field is ignored for them.
  const session = await getSession();
  const sessionEmail = (session?.profile?.email ?? session?.user?.email ?? "")
    .trim()
    .toLowerCase();
  const email = session
    ? sessionEmail
    : ((formData.get("email") as string) ?? "").trim().toLowerCase();

  if (!chapterId || !firstName || !lastName || !email) {
    return { error: "First name, last name, and email are required." };
  }

  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(applicationLimiter, ip, "application");
  if (rl.limited) return { error: rl.error! };

  const adminClient = createAdminClient();

  const chapter = await loadOpenChapter(adminClient, chapterId);
  if (!chapter) {
    return { error: "Applications are not currently open for this match." };
  }

  const valid = await validateApplicationForm(adminClient, formData, chapter, email);
  if ("error" in valid) return valid;

  if (session) {
    const saved = await saveApplication(adminClient, {
      formData,
      chapter,
      email,
      firstName,
      lastName,
      userId: session.user.id,
      cvFile: valid.cvFile,
    });
    if ("error" in saved) return saved;
    return { success: true, cvUploadFailed: saved.cvUploadFailed, signedIn: true };
  }

  // Not signed in. An address that already has an account needs no password:
  // the code proves the email, and the application joins that account. A new
  // address sets the password of the account the code step will create.
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!existingProfile) {
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
    if (password !== passwordConfirm) {
      return { error: "Passwords do not match." };
    }
  }

  const code = generateVerificationCode();
  const { data: verification, error: insertError } = await adminClient
    .from("verification_codes")
    .insert({
      email,
      code,
      type: "application_registration",
      metadata: {
        chapterId: chapter.id,
        email,
        // Never plaintext, and only when an account is to be created.
        password: existingProfile ? null : encryptPassword(password),
      },
      expires_at: new Date(Date.now() + APPLICATION_CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !verification) {
    console.error("Application verification insert error:", insertError);
    return { error: "Failed to start verification. Please try again." };
  }

  // Awaited, like every verification code: the applicant is waiting for it.
  const html = await renderVerificationCodeEmail({
    name: firstName,
    code,
    type: "application_registration",
    chapterName: chapter.name,
  });
  try {
    await sendEmail({ to: email, subject: "Your EHL verification code", html });
  } catch {
    await adminClient.from("verification_codes").delete().eq("id", verification.id);
    return { error: "Failed to send verification email. Please try again in a moment." };
  }

  return { verificationId: verification.id as string, email };
}

export async function confirmApplication(formData: FormData): Promise<ApplyResult> {
  const verificationId = (formData.get("verificationId") as string) ?? "";
  const code = ((formData.get("code") as string) ?? "").trim();
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();

  if (!verificationId || !code) {
    return { error: "Please enter the code from your email." };
  }
  if (!firstName || !lastName) {
    return { error: "First name, last name, and email are required." };
  }

  const adminClient = createAdminClient();

  const { data: record } = await adminClient
    .from("verification_codes")
    .select("*")
    .eq("id", verificationId)
    .eq("type", "application_registration")
    .is("verified_at", null)
    .maybeSingle();

  if (!record) {
    return { error: "This code is no longer valid. Please submit the form again." };
  }
  if (new Date(record.expires_at as string) < new Date()) {
    return { error: "Your code expired. Please submit the form again." };
  }
  const attempts = (record.attempts as number) ?? 0;
  if (attempts >= APPLICATION_CODE_MAX_ATTEMPTS) {
    return { error: "Too many failed attempts. Please submit the form again." };
  }
  if (record.code !== code) {
    await adminClient
      .from("verification_codes")
      .update({ attempts: attempts + 1 })
      .eq("id", verificationId);
    const remaining = APPLICATION_CODE_MAX_ATTEMPTS - 1 - attempts;
    return {
      error:
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Incorrect code. Please submit the form again.",
    };
  }

  const meta = record.metadata as {
    chapterId: string;
    email: string;
    password: string | null;
  };
  const email = (record.email as string).trim().toLowerCase();

  // Re-validate the resubmitted form BEFORE claiming the code, so a fixable
  // mistake (a missing field, a closed chapter message) does not burn it.
  const chapter = await loadOpenChapter(adminClient, meta.chapterId);
  if (!chapter) {
    return { error: "Applications are not currently open for this match." };
  }
  const valid = await validateApplicationForm(adminClient, formData, chapter, email);
  if ("error" in valid) return valid;

  // Atomically claim the code: of two concurrent confirms (double click, two
  // tabs) only one proceeds.
  const { data: claimed } = await adminClient
    .from("verification_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", verificationId)
    .is("verified_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return { error: "This code was already used. Please log in to see your application." };
  }
  // Hand the code back if anything below fails, so the applicant can retry with
  // the same code instead of starting over.
  const releaseClaim = () =>
    adminClient
      .from("verification_codes")
      .update({ verified_at: null })
      .eq("id", verificationId);

  // Resolve the account. The profile is looked up again rather than trusting
  // step one: the applicant may have registered in another tab since.
  let userId: string;
  let createdAccount = false;
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    userId = existingProfile.id as string;
  } else if (meta.password) {
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: decryptPassword(meta.password),
      email_confirm: true,
      user_metadata: { name: `${firstName} ${lastName}` },
    });
    if (authError || !authData.user) {
      await releaseClaim();
      console.error("Application account creation error:", authError);
      return { error: "We could not create your account. Please try again." };
    }
    userId = authData.user.id;
    createdAccount = true;
    // The 00055 trigger creates the profile; this sets the name and role the
    // way every registration path does.
    await adminClient.from("profiles").upsert({
      id: userId,
      email,
      name: `${firstName} ${lastName}`,
      role: "participant",
    });
    logEvent({
      action: "registration.application_completed",
      entityType: "profile",
      entityId: userId,
      actorId: userId,
      actorType: "participant",
      delta: { created: { email, chapter_id: chapter.id } },
    });
  } else {
    // Step one saw an account for this email, and it is gone now.
    await releaseClaim();
    return { error: "Please submit the form again." };
  }

  const saved = await saveApplication(adminClient, {
    formData,
    chapter,
    email,
    firstName,
    lastName,
    userId,
    cvFile: valid.cvFile,
  });
  if ("error" in saved) {
    // A new account stays (the next attempt finds it by email); the code is
    // handed back so that attempt does not need a new one.
    await releaseClaim();
    return saved;
  }

  // Consumed: delete it so the encrypted password is not retained.
  await adminClient.from("verification_codes").delete().eq("id", verificationId);

  // Sign a NEW account in, so the applicant lands logged in. An existing
  // account proved its email but not its password, so it is not signed in.
  let signedIn = false;
  if (createdAccount && meta.password) {
    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: decryptPassword(meta.password),
    });
    signedIn = !signInError;
  }

  return { success: true, cvUploadFailed: saved.cvUploadFailed, signedIn };
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

  // Find the current team membership (a returning participant may also hold
  // memberships from earlier, completed chapters)
  const membership = await getCurrentMembership(adminClient, profile.id as string);

  if (!membership) return null;

  // Get team name
  const { data: team } = await adminClient
    .from("teams")
    .select("id, name")
    .eq("id", membership.teamId)
    .single();

  if (!team) return null;

  return { teamId: team.id as string, teamName: team.name as string };
}

// ─── Admin: Delete application ─────────────────────────────────

export async function deleteApplication(applicationId: string) {
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

  const authErr = await requireChapterAdminAction(app.chapter_id as string);
  if (authErr) return { error: authErr };

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };

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
    actorId: session.user.id,
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
  // Cancellation must go through cancelApplication(), which records the reason,
  // a note, and the cancel metadata. The generic action only writes status, so
  // it must never produce a "cancelled" row (that would be a terminal state with
  // no cancelled_at / cancel_reason / note / audit).
  if (status === "cancelled") {
    return { error: "Use the cancel action to cancel an applicant." };
  }

  const adminClient = createAdminClient();

  // Check if status is locked (email already sent)
  const { data: app } = await adminClient
    .from("applications")
    .select("acceptance_email_sent_at, rejection_email_sent_at, status, chapter_id")
    .eq("id", applicationId)
    .single();

  const authErr = await requireChapterAdminAction(app?.chapter_id as string);
  if (authErr) return { error: authErr };

  // Cancellation is terminal: a cancelled applicant can never be reactivated via
  // the generic status action. The UI disables the buttons, but this server
  // action is a public endpoint, so the invariant must be enforced here too.
  // (An applicant cancelled while only "accepted"/"checked_in" has no email
  // timestamp, so the email lock below would not catch it.)
  if (app?.status === "cancelled") {
    return { error: "Cancelled applications cannot be reactivated." };
  }

  if (app?.acceptance_email_sent_at || app?.rejection_email_sent_at) {
    return { error: "Cannot change status after email has been sent." };
  }

  const previousStatus = app?.status as string | undefined;

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };

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
    actorId: session.user.id,
    actorType: "admin",
    delta: { status: { from: previousStatus ?? "unknown", to: status } },
  });

  return { success: true };
}

export async function bulkUpdateApplicationStatus(
  applicationIds: string[],
  status: ApplicationStatus
) {
  // Cancellation must go through cancelApplication() (per-applicant reason +
  // note + audit), never the bulk status action.
  if (status === "cancelled") {
    return { error: "Use the cancel action to cancel an applicant." };
  }

  const adminClient = createAdminClient();

  // Filter out locked applications (email already sent) and cancelled ones
  const { data: apps } = await adminClient
    .from("applications")
    .select("id, acceptance_email_sent_at, rejection_email_sent_at, status, chapter_id")
    .in("id", applicationIds);

  const chapterId = (apps ?? [])[0]?.chapter_id as string | undefined;
  const authErr = await requireChapterAdminAction(chapterId ?? "");
  if (authErr) return { error: authErr };

  // Reject if any application belongs to a different chapter.
  const crossChapter = (apps ?? []).some((a) => a.chapter_id !== chapterId);
  if (crossChapter) return { error: "All applications must belong to the same chapter." };

  // Cancelled applications are terminal and excluded, just like email-locked ones.
  const actionableIds = (apps ?? [])
    .filter(
      (a) =>
        a.status !== "cancelled" &&
        !a.acceptance_email_sent_at &&
        !a.rejection_email_sent_at
    )
    .map((a) => a.id as string);

  if (actionableIds.length === 0) {
    return { error: "All selected applications are locked (email already sent) or cancelled." };
  }

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };

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
    actorId: session.user.id,
    actorType: "admin",
    delta: { updated: { count: applicationIds.length, to_status: status } },
  });

  return { success: true };
}

/** Never let a caller (or a forged client request) exceed the default budget. */
function clampSendBudget(budgetMs?: number): number {
  if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    return EMAIL_SEND_BUDGET_MS;
  }
  return Math.min(budgetMs, EMAIL_SEND_BUDGET_MS);
}

// ─── Admin: Send acceptance emails with QR codes ─────────────

/**
 * `budgetMs` lets a caller running several sends in one request share a single
 * wall-clock budget across them (see sendBulkEmails). It is CLAMPED to the
 * default: this is an exported server action, so a client could otherwise ask
 * for an arbitrarily long-running function.
 */
export async function sendAcceptanceEmails(
  applicationIds: string[],
  opts?: { budgetMs?: number }
) {
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

  // Per-chapter email customization lives in the admin-only chapter_communications
  // table (never on the public chapters row). Fetch it once for the whole batch;
  // when no row exists / fields are null, the email is byte-identical to legacy.
  const comms = await getChapterCommunications(chapterId as string);

  // Already-emailed applicants are filtered out BEFORE the run, so `remaining`
  // below counts only real work the budget did not get to.
  const pending = applications.filter((app) => !app.acceptance_email_sent_at);

  let sent = 0;
  const failed: string[] = [];

  // Concurrent and time-budgeted (see lib/bulk-send.ts). This used to be a
  // sequential loop with no cap at all: selecting 85 applicants meant 85 SMTP
  // round trips plus 85 QR renders in one request, which could exceed the
  // function timeout and die mid-batch, leaving some sent and no record of how
  // far it got. The acceptance_email_sent_at stamp made that recoverable, but
  // only if the admin knew to press again.
  const { skipped } = await runBudgetedConcurrent(pending, async (app) => {
    try {
      // Rendering, sending and stamping live in lib/acceptance-email.ts, shared
      // with the Grand Finale invite flow so both paths mail the identical
      // message. One bad row (e.g. a null check_in_token) throws here and fails
      // only that applicant, not the whole batch. When both customisation
      // fields are null the email is byte-identical to the legacy one.
      await deliverAcceptanceEmail(
        {
          id: app.id as string,
          email: app.email as string,
          first_name: app.first_name as string,
          check_in_token: app.check_in_token as string,
          chapters: app.chapters as AcceptanceEmailApplication["chapters"],
        },
        comms
      );
      sent++;
    } catch (err) {
      console.error(`Failed to send acceptance email to ${app.email}:`, err);
      failed.push(app.email as string);
    }
  }, { budgetMs: clampSendBudget(opts?.budgetMs) });

  const remaining = skipped.length;

  if (failed.length > 0) {
    return { success: true, sent, remaining, error: `Failed to send to: ${failed.join(", ")}` };
  }
  return { success: true, sent, remaining };
}

// ─── Admin: Send rejection emails ──────────────────────────

/** See sendAcceptanceEmails for `budgetMs`; it is clamped the same way. */
export async function sendRejectionEmails(
  applicationIds: string[],
  opts?: { budgetMs?: number }
) {
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

  // Already-emailed applicants are filtered out BEFORE the run, so `remaining`
  // counts only real work the budget did not get to.
  const pending = applications.filter((app) => !app.rejection_email_sent_at);

  let sent = 0;
  const failed: string[] = [];

  // Same treatment as sendAcceptanceEmails: concurrent and time-budgeted rather
  // than an uncapped sequential loop (see lib/bulk-send.ts).
  const { skipped } = await runBudgetedConcurrent(pending, async (app) => {
    const chapter = app.chapters as Record<string, unknown>;
    const dateStr = formatDateRange(
      chapter.date as string,
      chapter.date_end as string | null
    );

    try {
      // Rendering sits INSIDE the try. It used to be outside, so a single
      // template failure threw out of the whole action and abandoned every
      // remaining applicant, rather than failing just that one.
      const html = await renderApplicationRejectedEmail({
        firstName: app.first_name as string,
        chapterName: chapter.name as string,
        chapterCity: `${chapter.city}, ${chapter.country}`,
        chapterDate: dateStr,
      });

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
      failed.push(app.email as string);
    }
  }, { budgetMs: clampSendBudget(opts?.budgetMs) });

  const remaining = skipped.length;

  // Failures used to be logged to the server console and swallowed, so the
  // admin saw a plain success count and never learned an address had bounced.
  if (failed.length > 0) {
    return { success: true, sent, remaining, error: `Failed to send to: ${failed.join(", ")}` };
  }
  return { success: true, sent, remaining };
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

  // Authorize before distinguishing not-found from unauthorized, so an
  // unauthorized caller cannot use the error to probe which application IDs
  // exist. When the row is missing we have no chapter_id, so run the guard with
  // an empty chapter: only a global admin passes (and may see "not found");
  // everyone else gets the generic auth error regardless of existence.
  const authErr = await requireChapterAdminAction(
    (app?.chapter_id as string) ?? ""
  );
  if (authErr) return { error: authErr };

  if (!app) {
    return { error: "Application not found." };
  }

  // Cancelling only makes sense for someone who was going to attend: an accepted
  // or checked-in applicant who can no longer come. Pending/rejected/waitlisted
  // applicants are handled by the normal review flow, not by this terminal path.
  // This mirrors the button visibility in the admin UI.
  if (app.status !== "accepted" && app.status !== "checked_in") {
    if (app.status === "cancelled") {
      return { error: "This applicant is already cancelled." };
    }
    return { error: "Only accepted or checked-in applicants can be cancelled." };
  }

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };
  const actorId = session.user.id;
  const actorEmail = session.profile?.email ?? null;
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

  // Keep event-participation state consistent: a cancelled attendee must not
  // remain in any challenge_registrations.roster, where they would still count
  // toward the team (submission gating only checks the submitter's own check-in,
  // never re-validates the roster). Rosters store profiles.id, but applications
  // are keyed by email, so resolve the profile first. Best-effort: a failure
  // here does not fail the cancel, since the application is already cancelled.
  const cancelledEmail = app.email as string;
  let rostersUpdated = 0;
  let registrationsRemoved = 0;
  const { data: profileRow } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", cancelledEmail)
    .maybeSingle();
  const cancelledUserId = (profileRow?.id as string) ?? null;
  if (cancelledUserId) {
    const { data: regs } = await adminClient
      .from("challenge_registrations")
      .select("id, roster")
      .eq("chapter_id", app.chapter_id as string);
    for (const reg of regs ?? []) {
      const roster = (reg.roster as string[]) ?? [];
      if (!roster.includes(cancelledUserId)) continue;
      const nextRoster = roster.filter((uid) => uid !== cancelledUserId);
      // Removing the member can drop the roster below the registration minimum.
      // Such a registration is invalid (submission gating only checks that a
      // registration row exists, not its size), so delete it rather than persist
      // an under-strength roster the team could still submit with. The team must
      // re-register with a valid roster.
      if (nextRoster.length < MIN_CHALLENGE_ROSTER) {
        const { error: delErr } = await adminClient
          .from("challenge_registrations")
          .delete()
          .eq("id", reg.id as string);
        if (!delErr) registrationsRemoved++;
      } else {
        const { error: regErr } = await adminClient
          .from("challenge_registrations")
          .update({ roster: nextRoster })
          .eq("id", reg.id as string);
        if (!regErr) rostersUpdated++;
      }
    }
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
      rosters_updated: rostersUpdated,
      registrations_removed: registrationsRemoved,
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

// Note: cancellation is terminal. Once an applicant is cancelled there is no
// further status transition at all: updateApplicationStatus refuses to act on a
// cancelled row (no reversal to accepted, and no move to rejected either). This
// is enforced server-side, not just in the UI.

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

  // Authorize before distinguishing not-found from unauthorized (see
  // cancelApplication): prevents probing application-ID existence.
  const authErr = await requireChapterAdminAction(
    (app?.chapter_id as string) ?? ""
  );
  if (authErr) return { error: authErr };

  if (!app) {
    return { error: "Application not found." };
  }

  const session = await getSession();
  if (!session) return { error: "Could not identify admin user." };
  const actorId = session.user.id;
  const actorEmail = session.profile?.email ?? null;

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

// Note: application notes are read by the admin detail API route
// (app/api/admin/chapters/[id]/applications/[applicationId]/route.ts), which
// queries application_notes directly alongside the application, so there is no
// separate getApplicationNotes server action.

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

  // No fixed chunk: both senders are now individually time-budgeted, so one
  // press sends as many as fit. The two runs SHARE a single budget rather than
  // taking one each, which would have allowed 2x the budget in one request and
  // put the function timeout back in play.
  const started = Date.now();
  let acceptedSent = 0;
  let rejectedSent = 0;
  let remaining = 0;

  if (acceptedIds.length > 0) {
    const result = await sendAcceptanceEmails(acceptedIds, { budgetMs: EMAIL_SEND_BUDGET_MS });
    acceptedSent = result.sent ?? 0;
    remaining += result.remaining ?? 0;
  }

  // Whatever the acceptance run left of the shared budget.
  const leftMs = EMAIL_SEND_BUDGET_MS - (Date.now() - started);

  if (rejectedIds.length > 0) {
    if (leftMs > 0) {
      const result = await sendRejectionEmails(rejectedIds, { budgetMs: leftMs });
      rejectedSent = result.sent ?? 0;
      remaining += result.remaining ?? 0;
    } else {
      // Budget already spent on acceptances: report the rejections untouched
      // rather than starting a run that cannot finish.
      remaining += rejectedIds.length;
    }
  }

  return {
    success: true,
    acceptedSent,
    rejectedSent,
    remaining,
  };
}

// ─── Admin: QR Check-in ─────────────────────────────────────

export async function checkInApplication(checkInToken: string) {
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

  // Resolve the acting admin SERVER-SIDE. The check-in screen is a client
  // component, so a client-supplied id can be forged; the audit attribution and
  // checked_in_by must come from the authenticated session, never the request.
  const adminUserId = await getActingUserId();
  if (!adminUserId) return { error: "Could not identify admin user." };

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

export async function checkInApplicationById(applicationId: string) {
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

  // Resolve the acting admin server-side (see checkInApplication): never trust a
  // client-supplied id for audit attribution or checked_in_by.
  const adminUserId = await getActingUserId();
  if (!adminUserId) return { error: "Could not identify admin user." };

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
