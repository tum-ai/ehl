"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin-allowlist";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import {
  renderJuryInviteEmail,
  renderJuryMagicLinkEmail,
  renderPasswordResetEmail,
  renderCreateAccountInviteEmail,
} from "@/lib/emails/render";
import { getSafeRedirect, getSiteUrl } from "@/lib/utils";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, authLimiter, resetLimiter, resetEmailLimiter } from "@/lib/ratelimit";
import { getLockingTeamId } from "@/lib/team-membership";

export async function signIn(formData: FormData, redirectTo?: string) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(authLimiter, ip, "login");
  if (rl.limited) return { error: rl.error! };

  // Block admin and jury accounts from email/password login
  const adminClient = createAdminClient();
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (existingProfile?.role === "admin" || existingProfile?.role === "jury") {
    return { error: "Invalid email or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Always return the same generic error: distinguishing "accepted application
    // but no account yet" from "wrong credentials" would be an account-enumeration
    // oracle (and we must not email on a failed password attempt). The login page
    // already offers "Forgot password?" and "Register" for accepted-but-
    // unregistered users; the reset flow emails them a claim link.
    return { error: "Invalid email or password." };
  }

  // Check role to redirect correctly
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Authentication failed." };
  }

  // If a redirect URL is provided and it's a safe internal path, use it
  const safeRedirect = getSafeRedirect(redirectTo);
  if (safeRedirect) {
    redirect(safeRedirect);
  }

  redirect("/dashboard");
}

export async function signInAdminWithGoogle() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/admin`,
      queryParams: {
        ...(process.env.ADMIN_EMAIL_DOMAIN ? { hd: process.env.ADMIN_EMAIL_DOMAIN } : {}),
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.url) {
    redirect(data.url);
  }

  return { error: "Failed to initiate Google sign-in." };
}

export async function signInChapterAdminWithGoogle() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/admin`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.url) {
    redirect(data.url);
  }

  return { error: "Failed to initiate Google sign-in." };
}

export async function signInJury(formData: FormData) {
  const email = formData.get("email") as string;
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(authLimiter, ip, "login");
  if (rl.limited) return { error: rl.error! };

  const siteUrl = getSiteUrl();
  const adminClient = createAdminClient();

  // Verify the user exists and is a jury member via profiles table
  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, role, name")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (!profile || (profile.role !== "jury" && profile.role !== "admin")) {
    return { error: "No jury account found for this email." };
  }

  // Verify the auth user exists
  const { data: authUser, error: authError } = await adminClient.auth.admin.getUserById(profile.id as string);

  if (authError || !authUser?.user) {
    return { error: "No jury account found for this email." };
  }

  // Generate a magic link
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=/jury`,
    },
  });

  if (linkError || !linkData.properties?.hashed_token) {
    return { error: "Failed to send login link. Please try again." };
  }

  // Build the magic link through our auth callback (bypasses implicit flow)
  const magicLink = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/jury`;

  // Send custom styled magic link email
  const html = await renderJuryMagicLinkEmail({
    name: (profile.name as string) || "Jury Member",
    magicLink,
  });

  await sendEmail({
    to: email,
    subject: "Your EHL Jury Portal login link",
    html,
  });

  return { success: true };
}

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email") as string;
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(resetLimiter, ip, "password reset");
  if (rl.limited) return { error: rl.error! };

  // Per-RECIPIENT throttle dedicated to reset emails, applied to EVERY normalized
  // email BEFORE any account-specific logic. This prevents reset-email bombing of
  // a victim address, and because it runs before we ever look up the account AND
  // returns the same generic success on a hit, it is not an account-enumeration
  // oracle (known and unknown emails behave identically when throttled). It is
  // separate from the general per-address emailLimiter so ordinary transactional
  // mail the user recently received does not block a reset.
  const normalizedEmail = email.trim().toLowerCase();
  const resetEmailRl = await checkRateLimit(
    resetEmailLimiter,
    normalizedEmail,
    "password reset email"
  );
  if (resetEmailRl.limited) {
    // Same response as the happy path: no email is sent, and nothing reveals
    // whether the address has an account.
    return { success: true };
  }

  const adminClient = createAdminClient();
  const siteUrl = getSiteUrl();

  // Block admin and jury accounts from password reset
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (profile?.role === "admin" || profile?.role === "jury") {
    // Don't reveal that the account exists, just silently succeed
    return { success: true };
  }

  // Check if this email has an accepted application but no auth account
  const { data: application } = await adminClient
    .from("applications")
    .select("id, status, first_name")
    .eq("email", email.trim().toLowerCase())
    .in("status", ["accepted", "checked_in"])
    .limit(1)
    .single();

  if (application) {
    // Check if auth user exists by looking up profile
    const { data: profileCheck } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .single();

    let hasAccount = false;
    if (profileCheck) {
      const { data: authCheck } = await adminClient.auth.admin.getUserById(profileCheck.id as string);
      hasAccount = !!authCheck?.user;
    }

    if (!hasAccount) {
      // Accepted application but no account yet: there's nothing to reset. Rather
      // than return a DISTINCT response (which would be an enumeration oracle) or
      // a silent dead-end, email a "create your account" link and return the SAME
      // generic success as every other path. Deferred so an SMTP failure is logged,
      // not reflected in the response.
      const firstName = (application.first_name as string) || "there";
      const registerUrl = `${siteUrl}/register?email=${encodeURIComponent(normalizedEmail)}`;
      sendEmailAfterResponse("create-account invite", async () => {
        const html = await renderCreateAccountInviteEmail({
          name: firstName,
          email: normalizedEmail,
          registerUrl,
        });
        await sendEmail({
          to: normalizedEmail,
          subject: "Create your EHL account",
          html,
          // The per-recipient resetEmailLimiter (run before this lookup) already
          // capped this address, so skip the general per-address throttle.
          skipRateLimit: true,
        });
      });
      return { success: true };
    }
  }

  // Generate a password reset link via the admin API
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase(),
    options: {
      redirectTo: `${siteUrl}/reset-password`,
    },
  });

  // Genuine "no account for this email": GoTrue returns a stable error code
  // (user_not_found / 404). Stay silent so we never reveal whether the email
  // exists (enumeration protection). Match on the stable code, NOT the message.
  const errCode = (error as { code?: string; status?: number } | null)?.code;
  const errStatus = (error as { code?: string; status?: number } | null)?.status;
  if (error && (errCode === "user_not_found" || errStatus === 404)) {
    return { success: true };
  }

  if (error || !data.properties?.hashed_token) {
    // A REAL failure (auth outage, corrupted auth.users row, or the invariant
    // violation of "no error but no token"). Returning fake success here is what
    // silently dropped a captain's reset in the Paris dry-run: the user saw
    // "email sent" though none was generated. Return the SAME generic transient
    // error for EVERY email so this path is not an enumeration oracle, while
    // still telling the user the reset did not go through.
    console.error("[requestPasswordReset] generateLink failed:", error?.message ?? "no token");
    return {
      error:
        "We couldn't generate your reset link right now. Please try again in a moment, or contact support if it keeps happening.",
    };
  }

  // Build the reset URL through our auth callback
  const resetUrl = `${siteUrl}/auth/callback?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`;

  // Look up user name for a personal greeting
  const { data: userProfile } = await adminClient
    .from("profiles")
    .select("name")
    .eq("email", email.trim().toLowerCase())
    .single();

  const name = (userProfile?.name as string) || "there";

  const html = await renderPasswordResetEmail({ name, resetUrl });

  try {
    await sendEmail({
      to: email,
      subject: "Reset your EHL password",
      html,
      // The dedicated resetEmailLimiter above is the per-recipient guard for
      // resets, so skip the general per-address emailLimiter here.
      skipRateLimit: true,
    });
  } catch (err) {
    console.error("Failed to send password reset email:", err);
    return { error: "Failed to send reset email. Please try again in a moment." };
  }

  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Last-resort self-heal: a logged-in user must always have a profile. The DB
  // trigger (migration 00055) guarantees this for new accounts; this repairs any
  // pre-existing profileless account (e.g. an imported user) on their next
  // authenticated request, so the FK to profiles(id) and participant views never
  // break. Fail-soft: a repair hiccup must never break the session/login.
  if (!profile) {
    try {
      const email = (user.email ?? "").trim().toLowerCase();
      const role = email && (await isAdminEmail(email)) ? "admin" : "participant";
      const adminClient = createAdminClient();
      await adminClient
        .from("profiles")
        .upsert(
          {
            id: user.id,
            email: user.email ?? null,
            name:
              (user.user_metadata?.full_name as string) ||
              (user.user_metadata?.name as string) ||
              user.email ||
              null,
            role,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );
      const reread = await supabase.from("profiles").select("*").eq("id", user.id).single();
      profile = reread.data;
    } catch (e) {
      console.error("getSession: profile self-heal failed for", user.id, e);
    }
  }

  return {
    user,
    profile: profile
      ? {
          id: profile.id as string,
          name: (profile.name as string) ?? null,
          email: (profile.email as string) ?? null,
          role: (profile.role as string) ?? "participant",
          lookingForTeam: (profile.looking_for_team as boolean) ?? false,
        }
      : null,
  };
}

export async function inviteJury(
  email: string,
  name: string,
  challengeId: string,
  chapterId: string
) {
  const { requireAdminAction } = await import("@/lib/admin-auth");
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const siteUrl = getSiteUrl();

  // Check if user already exists
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .single();

  let userId: string;

  if (existingProfile) {
    userId = existingProfile.id as string;
  } else {
    // No profile found - create a new user
    {
      // Create user account (no password needed for magic link auth)
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name },
      });

      if (error) return { error: error.message };
      if (!data.user) return { error: "Failed to create jury account." };
      userId = data.user.id;
    }
  }

  // Check for dual-role conflict: jury members must not be ACTIVE team members.
  // "Active" means a team registered for a chapter that has not completed, the
  // same condition the 00035 chapter-lock trigger uses. A user can hold several
  // team_members rows (Data Integrity 7), so the old `.limit(1).single()` read
  // an arbitrary one: anybody who had ever been on a team, including in a
  // finished season, was refused as jury forever.
  const lockingTeamId = await getLockingTeamId(adminClient, userId);

  if (lockingTeamId) {
    return { error: `This user is an active team member and cannot serve as jury. Remove them from their team first.` };
  }

  // Set profile role to jury
  await adminClient.from("profiles").upsert({
    id: userId,
    email,
    name,
    role: "jury",
  });

  // Assign to challenge directly
  await adminClient.from("jury_assignments").upsert({
    user_id: userId,
    challenge_id: challengeId,
    chapter_id: chapterId,
    status: "pending",
  });

  // Generate a magic link for the jury member
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=/jury`,
    },
  });

  if (linkError || !linkData.properties?.hashed_token) {
    return { error: "Failed to generate invite link." };
  }

  // Build the invite link through our auth callback (bypasses implicit flow)
  const inviteLink = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/jury`;

  // Get challenge name for the email
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("title")
    .eq("id", challengeId)
    .single();

  // Send custom styled invite email
  const html = await renderJuryInviteEmail({
    name,
    inviteLink,
    challengeName: (challenge?.title as string) || undefined,
  });

  await sendEmail({
    to: email,
    subject: "You're invited to judge at the EHL",
    html,
  });

  return { success: true, userId };
}
