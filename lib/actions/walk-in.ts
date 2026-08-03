"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireChapterAdminAction } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, applicationLimiter, walkInTokenLimiter } from "@/lib/ratelimit";
import { uploadFile } from "@/lib/gdrive";
import { logEvent } from "@/lib/event-log";
import { buildApplicationInsert } from "@/lib/applications-shared";
import { CV_MAX_BYTES, CV_MAX_LABEL } from "@/lib/config/upload-limits";

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

// ─── Submit a walk-in application (public, event-day) ────────
//
// A walk-in scans the per-chapter QR, fills the normal application form on their
// phone AND creates an account in one step, and becomes an auto-accepted full
// league participant. The unguessable token REPLACES the
// status === "applications_open" gate: walk-ins arrive during hacking /
// submissions_open, so we only reject the hygiene statuses draft/completed.
export async function submitWalkInApplication(
  formData: FormData
): Promise<{ error: string } | { success: true; checkInToken: string; cvUploadFailed?: boolean }> {
  const walkInToken = (formData.get("walkInToken") as string)?.trim();
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
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
      return { error: "A password is required to create your account." };
    }
    if (password.length < 8) {
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
  // behavior is gated on PROVEN identity: the caller must be SIGNED IN as the
  // account that owns the email.
  //
  // Behavior matrix (signed in as `email`):
  //   - accepted/checked_in application for THIS chapter → return the existing
  //     check-in token (no writes). Fixes the "already registered" dead-end.
  //   - no application for this chapter → create an accepted application for the
  //     EXISTING account (no new account), return its check-in token.
  //   - pending/waitlisted/rejected/cancelled here → don't auto-promote via a
  //     public QR; send them to the registration desk.
  // Not signed in (or signed in as someone else) but the email already has an
  // account → refuse with a sign-in-first path (no account takeover, no oracle).
  // Reuses the session resolved at the top of the action.
  const isOwnerSignedIn = signedInAsThisEmail;

  const { data: existingApp } = await adminClient
    .from("applications")
    .select("id, status, check_in_token")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();

  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingApp) {
    // An application for this chapter already exists. Only the proven owner may
    // act on it; otherwise this stays a non-revealing generic message.
    if (!isOwnerSignedIn) {
      return {
        error:
          "An application with this email already exists for this match. Please sign in first, then reopen the walk-in link.",
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

  // An account exists for this email but the caller is NOT the signed-in owner:
  // refuse (no second account, no password change). NOTE: existingProfile may be
  // null even when an auth user exists (an imported/profileless user), so we also
  // guard the create path below by isOwnerSignedIn, not just existingProfile.
  if (existingProfile && !isOwnerSignedIn) {
    return {
      error:
        "An account with this email already exists. Please sign in first, then use the walk-in link.",
    };
  }
  if (existingProfile) {
    // Signed in as the owner: create an accepted application for the EXISTING
    // account (no new auth user), then fall through to the shared insert path.
  }

  // Validate the CV (optional) before any write so a Drive outage can never lose
  // the application. The upload happens AFTER the row is inserted.
  const cvFile = formData.get("cv") as File | null;
  const hasCv = !!cvFile && cvFile.size > 0;
  if (hasCv) {
    if (cvFile!.size > CV_MAX_BYTES) {
      return { error: `CV file must be under ${CV_MAX_LABEL}.` };
    }
    const ext = cvFile!.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf") {
      return { error: "CV must be a PDF file." };
    }
  }

  // Resolve the participant. Three paths reach here:
  //  - SIGNED-IN owner: reuse their authenticated account (session.user.id),
  //    regardless of whether a profiles row exists. A valid session can have a
  //    NULL profile (an imported/profileless user — the exact bug that blocks
  //    team formation), so we ALSO repair the missing profile here. We must NOT
  //    fall through to createUser for them: the auth user already exists, so
  //    createUser would fail with a duplicate and dead-end again.
  //  - NEW person: create the auth user + profile (mirrors registration.ts).
  const fullName = `${firstName} ${lastName}`;
  let userId: string;
  if (isOwnerSignedIn) {
    userId = earlySession!.user.id;
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
    .insert({ ...baseInsert, status: "accepted" })
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
  let cvUploadFailed = false;
  if (hasCv) {
    try {
      const chapterName = chapter.name.replace(/[^a-zA-Z0-9 ]/g, "");
      const fileName = `${lastName}_${firstName}_CV.pdf`;
      const result = await uploadFile(cvFile!, fileName, "application/pdf", [
        "CVs",
        chapterName,
      ]);
      await adminClient
        .from("applications")
        .update({ cv_url: result.fileId })
        .eq("id", inserted.id);
    } catch (err) {
      console.error("Walk-in CV upload error:", err);
      cvUploadFailed = true;
    }
  }

  logEvent({
    action: "application.walk_in_registered",
    entityType: "application",
    entityId: inserted.id as string,
    actorId: userId,
    actorType: "participant",
    delta: { created: { email, chapter_id: chapter.id } },
  });

  // Sign the NEW user in so they land logged in (mirrors registration.ts). A
  // signed-in owner is already authenticated — don't re-auth with the form
  // password (which may be blank/irrelevant for them).
  if (!isOwnerSignedIn) {
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
