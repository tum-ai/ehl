"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireChapterAdminAction } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  checkRateLimit,
  applicationLimiter,
  authLimiter,
  walkInTokenLimiter,
} from "@/lib/ratelimit";
import { logEvent } from "@/lib/event-log";
import { buildApplicationInsert } from "@/lib/applications-shared";
import { validateCv, attachCv } from "@/lib/application-cv";

export interface WalkInChapter {
  id: string;
  name: string;
  city: string;
  country: string;
  date: string;
  dateEnd: string | null;
  slug: string;
  status: string;
}

// ─── Resolve a chapter from a walk-in token ──────────────────
//
// The walk-in token lives in the admin-only chapter_walk_in table, which has NO
// anon read policy (RLS gates rows not columns, so the token could not live on
// the publicly-readable chapters row). We therefore read it with the service-role
// client. We look a chapter up BY token and never expose the token list. A miss
// returns null uniformly (no oracle distinguishing "no such token" from "token
// maps to a missing chapter").
export async function getWalkInChapterByToken(
  token: string
): Promise<WalkInChapter | null> {
  if (!token) return null;

  const adminClient = createAdminClient();

  const { data: row } = await adminClient
    .from("chapter_walk_in")
    .select("chapter_id")
    .eq("walk_in_token", token)
    .maybeSingle();

  if (!row?.chapter_id) return null;

  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id, name, city, country, date, date_end, slug, status")
    .eq("id", row.chapter_id as string)
    .maybeSingle();

  if (!chapter) return null;

  return {
    id: chapter.id as string,
    name: chapter.name as string,
    city: chapter.city as string,
    country: chapter.country as string,
    date: chapter.date as string,
    dateEnd: (chapter.date_end as string | null) ?? null,
    slug: chapter.slug as string,
    status: chapter.status as string,
  };
}

// Error codes the walk-in form acts on: "account_exists" switches it to the
// "I already have an account" mode (password only), "no_account" switches it back
// to account creation (password + confirm).
export type WalkInErrorCode = "account_exists" | "no_account";

// ─── Submit a walk-in application (public, event-day) ────────
//
// A walk-in scans the per-chapter QR, fills the normal application form on their
// phone AND creates an account in one step, and becomes an auto-accepted full
// league participant. The unguessable token REPLACES the
// status === "applications_open" gate: walk-ins arrive during hacking /
// submissions_open, so we only reject the hygiene statuses draft/completed.
export async function submitWalkInApplication(
  formData: FormData
): Promise<
  | { error: string; code?: WalkInErrorCode }
  | { success: true; checkInToken: string; cvUploadFailed?: boolean }
> {
  const walkInToken = (formData.get("walkInToken") as string)?.trim();
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  // "existing": the walk-in says they already have an EHL account and typed its
  // password, so we verify it instead of creating an account. Anything else is
  // the default account-creation mode.
  const wantsExistingAccount = formData.get("accountMode") === "existing";
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!walkInToken) {
    return { error: "Invalid walk-in link." };
  }
  // Resolve the session early: a signed-in owner reuses their account and so does
  // NOT need to supply a password (the field is for creating a new account).
  const earlySession = await getSession();
  const signedInAsThisEmail =
    !!earlySession && earlySession.user?.email?.toLowerCase() === email;

  if (!firstName || !lastName || !email) {
    return { error: "First name, last name, and email are required." };
  }
  if (!signedInAsThisEmail) {
    if (!password) {
      return {
        error: wantsExistingAccount
          ? "Please enter your EHL account password."
          : "A password is required to create your account.",
      };
    }
    // Only a rule for NEW passwords: an existing account's password is checked
    // by Supabase, not by us.
    if (!wantsExistingAccount && password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting: per IP (shared event WiFi gets the generous application
  // limit) AND per walk-in token (a single leaked QR can't be scripted into
  // mass account creation).
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const ipRl = await checkRateLimit(applicationLimiter, ip, "walk-in");
  if (ipRl.limited) return { error: ipRl.error! };
  const tokenRl = await checkRateLimit(walkInTokenLimiter, walkInToken, "walk-in");
  if (tokenRl.limited) return { error: tokenRl.error! };

  // The token is the gate (replaces the applications_open status check). A null
  // result means the token is invalid or maps to a missing chapter; both return
  // the same generic error so the action is not an existence oracle.
  const chapter = await getWalkInChapterByToken(walkInToken);
  if (!chapter) {
    return { error: "Invalid walk-in link." };
  }
  // Hygiene only: a draft chapter is not yet live and a completed one is over.
  // Every active status in between (registration_open, hacking, submissions_open,
  // pitching, ...) is a valid moment for a walk-in to arrive.
  if (chapter.status === "draft" || chapter.status === "completed") {
    return { error: "Walk-in registration is not available for this match." };
  }

  const adminClient = createAdminClient();

  // ── Existing-identity handling (idempotent walk-in) ───────────────────────
  // The walk-in QR is PUBLIC at the venue, so we must NEVER reveal an existing
  // applicant's personal check-in token from an emailed value alone. Idempotent
  // behavior is gated on PROVEN identity: the caller must be the owner of the
  // email, either already SIGNED IN as it, or signing in right here with the
  // account's password ("I already have an account" mode). The second path is
  // what keeps an existing account holder on this page: sending them to /login
  // lost the walk-in token and everything they had typed.
  //
  // Behavior matrix (proven owner of `email`):
  //   - accepted/checked_in application for THIS chapter → return the existing
  //     check-in token (no writes). Fixes the "already registered" dead-end.
  //   - no application for this chapter → create an accepted application for the
  //     EXISTING account (no new account), return its check-in token.
  //   - pending/waitlisted/rejected/cancelled here → don't auto-promote via a
  //     public QR; send them to the registration desk.
  // Not the proven owner but the email already has an account → refuse with
  // code "account_exists" so the form asks for the account password (no account
  // takeover, no second account).
  const { data: existingApp } = await adminClient
    .from("applications")
    .select("id, status, check_in_token")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();

  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();

  // Proven ownership: already signed in as this email, or the password sign-in
  // below succeeds. ownerUserId is that account's auth user id.
  let isOwner = signedInAsThisEmail;
  let ownerUserId: string | null = signedInAsThisEmail ? earlySession!.user.id : null;

  if (!isOwner && wantsExistingAccount) {
    // Admin and jury accounts never sign in with a password (same rule and same
    // generic message as signIn in lib/actions/auth.ts).
    if (existingProfile?.role === "admin" || existingProfile?.role === "jury") {
      return { error: "Invalid email or password.", code: "account_exists" };
    }
    const authRl = await checkRateLimit(authLimiter, ip, "walk-in-login");
    if (authRl.limited) return { error: authRl.error! };

    // Try the password even when no profile row matched: an auth user can exist
    // without one (an imported account), and answering "no account" would send
    // them to account creation, whose createUser duplicate sends them straight
    // back here. A successful sign-in reaches the profile repair below.
    // Sets the session cookie, so the walk-in also ends up logged in.
    const supabase = await createClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signInData?.user) {
      if (!existingProfile) {
        // They think they have an account, but this email has none. Never
        // create one from a password they typed only once: send them to
        // account creation, which asks for the confirmation.
        return {
          error:
            "We couldn't find an EHL account with this email. Create one below instead.",
          code: "no_account",
        };
      }
      return {
        error:
          "That password doesn't match this EHL account. Try again, or reset it with \"Forgot password?\".",
        code: "account_exists",
      };
    }
    isOwner = true;
    ownerUserId = signInData.user.id;
  }

  if (existingApp) {
    // An application for this chapter already exists. Only the proven owner may
    // act on it; otherwise this stays a non-revealing generic message.
    if (!isOwner) {
      return {
        error:
          "An application with this email already exists for this match. Please sign in first with your EHL account password.",
        ...(existingProfile ? { code: "account_exists" as const } : {}),
      };
    }
    if (existingApp.status === "accepted" || existingApp.status === "checked_in") {
      // Idempotent: hand back the existing personal check-in QR, no writes.
      return { success: true, checkInToken: existingApp.check_in_token as string };
    }
    // pending / waitlisted / rejected / cancelled must not be promoted by a QR.
    return {
      error:
        "You already have an application for this match that can't be auto-accepted here. Please see the registration desk.",
    };
  }

  // An account exists for this email but the caller is NOT the proven owner:
  // refuse (no second account, no password change) and let the form switch to
  // the "I already have an account" mode. NOTE: existingProfile may be null even
  // when an auth user exists (an imported/profileless user); createUser failing
  // below is mapped to the same code.
  if (existingProfile && !isOwner) {
    return {
      error:
        "This email already has an EHL account. Please sign in first: enter your EHL account password below.",
      code: "account_exists",
    };
  }

  // Validate the CV (optional) before any write so a Drive outage can never lose
  // the application. The upload happens AFTER the row is inserted.
  const cv = validateCv(formData);
  if ("error" in cv) return cv;
  const { cvFile } = cv;

  // Resolve the participant. Three paths reach here:
  //  - PROVEN owner (signed in already, or just signed in with the password):
  //    reuse their authenticated account (ownerUserId),
  //    regardless of whether a profiles row exists. A valid session can have a
  //    NULL profile (an imported/profileless user — the exact bug that blocks
  //    team formation), so we ALSO repair the missing profile here. We must NOT
  //    fall through to createUser for them: the auth user already exists, so
  //    createUser would fail with a duplicate and dead-end again.
  //  - NEW person: create the auth user + profile (mirrors registration.ts).
  const fullName = `${firstName} ${lastName}`;
  let userId: string;
  if (isOwner) {
    userId = ownerUserId!;
    // Self-heal: ensure the owner has a profile (idempotent; never downgrades an
    // existing role — upsert only sets role on first insert via the DB default).
    await adminClient
      .from("profiles")
      .upsert(
        { id: userId, email, name: fullName, role: "participant" },
        { onConflict: "id", ignoreDuplicates: true }
      );
  } else {
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullName },
    });

    if (authError || !authData.user) {
      // An auth user with this email exists but has no profile row (so the
      // check above missed it): same answer as an existing account.
      if (authError && /already (been )?registered|already exists/i.test(authError.message)) {
        return {
          error:
            "This email already has an EHL account. Please sign in first: enter your EHL account password below.",
          code: "account_exists",
        };
      }
      return { error: authError?.message || "Failed to create account." };
    }

    userId = authData.user.id;

    await adminClient.from("profiles").upsert({
      id: userId,
      email,
      name: fullName,
      role: "participant",
    });
  }

  // Insert the application as AUTO-ACCEPTED. check_in_token auto-generates so the
  // existing personal check-in QR flow handles the rest, unchanged.
  const baseInsert = buildApplicationInsert(formData, {
    chapterId: chapter.id,
    firstName,
    lastName,
    email,
  });

  const { data: inserted, error: insertError } = await adminClient
    .from("applications")
    .insert({ ...baseInsert, status: "accepted", user_id: userId })
    .select("id, check_in_token")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return { error: "An application with this email already exists for this match." };
    }
    console.error("Walk-in application insert error:", insertError);
    return { error: "Failed to register. Please try again." };
  }

  // Upload the CV (optional) and attach it. A failure here does not lose the
  // application; the walk-in is told the CV part failed.
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
    action: "application.walk_in_registered",
    entityType: "application",
    entityId: inserted.id as string,
    actorId: userId,
    actorType: "participant",
    delta: { created: { email, chapter_id: chapter.id } },
  });

  // Sign the NEW user in so they land logged in (mirrors registration.ts). A
  // proven owner is already authenticated (their session, or the password
  // sign-in above), so don't sign in a second time.
  if (!isOwner) {
    const supabase = await createClient();
    await supabase.auth.signInWithPassword({ email, password });
  }

  return {
    success: true,
    checkInToken: inserted.check_in_token as string,
    cvUploadFailed,
  };
}

// ─── Admin: rotate a chapter's walk-in token ─────────────────
//
// Invalidates any previously printed QR. Guarded to the chapter's admins.
export async function rotateWalkInToken(
  chapterId: string
): Promise<{ error: string } | { token: string }> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;

  const adminClient = createAdminClient();

  const newToken = crypto.randomUUID();
  const { data, error } = await adminClient
    .from("chapter_walk_in")
    .upsert(
      {
        chapter_id: chapterId,
        walk_in_token: newToken,
        rotated_at: new Date().toISOString(),
        rotated_by: actorId,
      },
      { onConflict: "chapter_id" }
    )
    .select("walk_in_token")
    .single();

  if (error || !data) {
    return { error: error?.message || "Failed to rotate token." };
  }

  logEvent({
    action: "chapter.walk_in_token_rotated",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { rotated: { chapter_id: chapterId } },
  });

  return { token: data.walk_in_token as string };
}

// ─── Admin: get-or-create a chapter's walk-in token ──────────
//
// Used by the admin walk-in page to display the current QR. Lazily creates the
// row (with a fresh uuid via the column default) on first view. Guarded to the
// chapter's admins.
export async function getOrCreateWalkInToken(
  chapterId: string
): Promise<{ error: string } | { token: string }> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("chapter_walk_in")
    .select("walk_in_token")
    .eq("chapter_id", chapterId)
    .maybeSingle();

  if (existing?.walk_in_token) {
    return { token: existing.walk_in_token as string };
  }

  const { data: created, error } = await adminClient
    .from("chapter_walk_in")
    .insert({ chapter_id: chapterId })
    .select("walk_in_token")
    .single();

  if (error || !created) {
    return { error: error?.message || "Failed to create walk-in token." };
  }

  return { token: created.walk_in_token as string };
}
