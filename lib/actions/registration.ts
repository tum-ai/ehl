"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendEmailAfterResponse } from "@/lib/email-deferred";
import {
  renderWelcomeEmail,
  renderVerificationCodeEmail,
  renderTeamInviteEmail,
} from "@/lib/emails/render";
import { slugify, getSafeRedirect } from "@/lib/utils";
import {
  encryptPassword,
  decryptPassword,
  generateVerificationCode,
} from "@/lib/crypto";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, registerLimiter } from "@/lib/ratelimit";
import { logEvent } from "@/lib/event-log";

// ─── Solo Registration ───────────────────────────────────

export async function startSoloRegistration(formData: FormData) {
  const name = formData.get("name") as string;
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  const lookingForTeam = formData.get("lookingForTeam") === "true";
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  if (!name || !email || !password) {
    return { error: "Name, email, and password are required." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(registerLimiter, ip, "registration");
  if (rl.limited) return { error: rl.error! };

  const adminClient = createAdminClient();

  // Check if email is already in use
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .single();
  if (existingProfile) {
    return { error: "An account with this email already exists. Try signing in." };
  }

  // Generate code and store (password encrypted, never plaintext)
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: verification, error: insertError } = await adminClient
    .from("verification_codes")
    .insert({
      email,
      code,
      type: "solo_registration",
      metadata: { name, email, password: encryptPassword(password), lookingForTeam },
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !verification) {
    return { error: "Failed to start verification. Please try again." };
  }

  const html = await renderVerificationCodeEmail({
    name,
    code,
    type: "solo_registration",
  });

  try {
    await sendEmail({
      to: email,
      subject: "Your EHL verification code",
      html,
    });
  } catch {
    return { error: "Failed to send verification email. Please try again in a moment." };
  }

  return { verificationId: verification.id };
}

export async function verifyAndRegisterSolo(
  verificationId: string,
  code: string,
  inviteToken?: string,
  redirectTo?: string
) {
  const adminClient = createAdminClient();
  const supabase = await createClient();

  // Fetch verification record
  const { data: record, error: fetchError } = await adminClient
    .from("verification_codes")
    .select("*")
    .eq("id", verificationId)
    .eq("type", "solo_registration")
    .is("verified_at", null)
    .single();

  if (fetchError || !record) {
    return { error: "Invalid or expired verification. Please register again." };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { error: "Verification code expired. Please register again." };
  }

  // Check attempt limit (max 5 tries)
  const attempts = (record.attempts as number) ?? 0;
  if (attempts >= 5) {
    return { error: "Too many failed attempts. Please register again." };
  }

  if (record.code !== code) {
    // Increment attempts
    await adminClient
      .from("verification_codes")
      .update({ attempts: attempts + 1 })
      .eq("id", verificationId);
    const remaining = 4 - attempts;
    return { error: `Incorrect code. ${remaining > 0 ? `${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` : "Please register again."}` };
  }

  // Atomically claim the verification (see verifyAndRegister): only the first
  // concurrent verify proceeds; a double-submit claims no row the second time.
  const { data: claimed } = await adminClient
    .from("verification_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", verificationId)
    .is("verified_at", null)
    .select("id")
    .single();

  if (!claimed) {
    return { error: "This verification was already used. Please sign in." };
  }

  const rawMeta = record.metadata as {
    name: string;
    email: string;
    password: string;
    lookingForTeam: boolean;
  };

  // Decrypt password (stored encrypted in verification record)
  const plaintextPassword = decryptPassword(rawMeta.password);

  // Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: rawMeta.email,
    password: plaintextPassword,
    email_confirm: true,
    user_metadata: { name: rawMeta.name },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Failed to create account." };
  }

  const userId = authData.user.id;

  // Create profile
  await adminClient.from("profiles").upsert({
    id: userId,
    email: rawMeta.email,
    name: rawMeta.name,
    role: "participant",
    looking_for_team: rawMeta.lookingForTeam,
  });

  logEvent({
    action: "registration.solo_completed",
    entityType: "profile",
    entityId: userId,
    actorType: "participant",
    delta: { created: { email: rawMeta.email, name: rawMeta.name } },
  });

  // If invite token provided, accept the invite automatically
  if (inviteToken) {
    const { data: invite } = await adminClient
      .from("team_invites")
      .select("*")
      .eq("token", inviteToken)
      .eq("status", "pending")
      .single();

    if (invite && new Date(invite.expires_at as string) > new Date()) {
      // Add to team
      const { data: memberCount } = await adminClient
        .from("team_members")
        .select("user_id", { count: "exact" })
        .eq("team_id", invite.team_id as string);

      if ((memberCount?.length ?? 0) < 5) {
        await adminClient.from("team_members").insert({
          team_id: invite.team_id,
          user_id: userId,
          role: "member",
        });

        await adminClient
          .from("team_invites")
          .update({ status: "accepted" })
          .eq("id", invite.id);
      }
    }
  }

  // Delete the consumed verification record so the encrypted password is not
  // retained indefinitely (the account now exists; the record is no longer needed).
  await adminClient.from("verification_codes").delete().eq("id", verificationId);

  // Sign in
  await supabase.auth.signInWithPassword({
    email: rawMeta.email,
    password: plaintextPassword,
  });

  const safeRedirect = getSafeRedirect(redirectTo);
  if (safeRedirect) {
    redirect(safeRedirect);
  }

  redirect("/dashboard");
}

// ─── Team Registration (with invite-based members) ───────

export async function startRegistration(formData: FormData) {
  const teamName = formData.get("teamName") as string;
  const presidentName = formData.get("presidentName") as string;
  const presidentEmail = (formData.get("presidentEmail") as string)
    ?.trim()
    .toLowerCase();
  const password = formData.get("password") as string;
  const university = (formData.get("university") as string) || null;
  const city = (formData.get("city") as string) || null;
  const turnstileToken = formData.get("cf-turnstile-response") as string;

  // Collect members
  const members: { name: string; email: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const name = formData.get(`memberName${i}`) as string;
    const email = (formData.get(`memberEmail${i}`) as string)?.trim().toLowerCase();
    if (name && email) {
      members.push({ name, email });
    }
  }

  // Validate
  if (!teamName || !presidentName || !presidentEmail || !password) {
    return { error: "Team name, president name, email, and password are required." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  // Bot protection
  const turnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!turnstileValid) {
    return { error: "Bot verification failed. Please try again." };
  }

  // Rate limiting
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(registerLimiter, ip, "registration");
  if (rl.limited) return { error: rl.error! };

  const adminClient = createAdminClient();

  // Check team name uniqueness
  const slug = slugify(teamName);
  if (!slug) {
    // Names with no latin alphanumerics (e.g. only emoji or non-latin script)
    // slugify to "", which would create a team with an unreachable /team/ URL.
    return {
      error: "Team name must contain letters or numbers.",
    };
  }
  const { data: existingTeam } = await adminClient
    .from("teams")
    .select("id")
    .eq("slug", slug)
    .single();

  if (existingTeam) {
    return { error: "A team with this name already exists." };
  }

  // Check if president email is already in use
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", presidentEmail.trim().toLowerCase())
    .single();
  if (existingProfile) {
    return { error: "An account with this email already exists. Try signing in." };
  }

  // Generate code and store with all form data (password encrypted, never plaintext)
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: verification, error: insertError } = await adminClient
    .from("verification_codes")
    .insert({
      email: presidentEmail,
      code,
      type: "registration",
      metadata: {
        teamName,
        presidentName,
        presidentEmail,
        password: encryptPassword(password),
        university,
        city,
        members,
      },
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !verification) {
    return { error: "Failed to start verification. Please try again." };
  }

  // Send verification code email
  const html = await renderVerificationCodeEmail({
    name: presidentName,
    code,
    type: "registration",
  });

  try {
    await sendEmail({
      to: presidentEmail,
      subject: "Your EHL verification code",
      html,
    });
  } catch {
    return { error: "Failed to send verification email. Please try again in a moment." };
  }

  return { verificationId: verification.id };
}

// ─── Verify code + create team (invite-based members) ────

export async function verifyAndRegister(verificationId: string, code: string, redirectTo?: string) {
  const adminClient = createAdminClient();
  const supabase = await createClient();

  // Fetch verification record
  const { data: record, error: fetchError } = await adminClient
    .from("verification_codes")
    .select("*")
    .eq("id", verificationId)
    .eq("type", "registration")
    .is("verified_at", null)
    .single();

  if (fetchError || !record) {
    return { error: "Invalid or expired verification. Please register again." };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { error: "Verification code expired. Please register again." };
  }

  // Check attempt limit (max 5 tries)
  const attempts = (record.attempts as number) ?? 0;
  if (attempts >= 5) {
    return { error: "Too many failed attempts. Please register again." };
  }

  if (record.code !== code) {
    await adminClient
      .from("verification_codes")
      .update({ attempts: attempts + 1 })
      .eq("id", verificationId);
    const remaining = 4 - attempts;
    return { error: `Incorrect code. ${remaining > 0 ? `${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` : "Please register again."}` };
  }

  // Atomically claim the verification: only the first concurrent verify wins.
  // .is("verified_at", null) makes a double-submit (two tabs / retried POST)
  // claim no row on the second attempt instead of both proceeding to
  // createUser and the loser getting a raw "already registered" error.
  const { data: claimed } = await adminClient
    .from("verification_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", verificationId)
    .is("verified_at", null)
    .select("id")
    .single();

  if (!claimed) {
    return { error: "This verification was already used. Please sign in." };
  }

  const rawMeta = record.metadata as {
    teamName: string;
    presidentName: string;
    presidentEmail: string;
    password: string;
    university: string | null;
    city: string | null;
    members: { name: string; email: string }[];
  };

  // Decrypt password (stored encrypted in verification record)
  const plaintextPassword = decryptPassword(rawMeta.password);
  const { teamName, presidentName, presidentEmail, university, city, members } = rawMeta;
  const slug = slugify(teamName);

  // Re-check slug uniqueness at verify time: two teams could have passed the
  // start-time check 15+ minutes ago with the same name.
  if (!slug) {
    return { error: "Team name must contain letters or numbers. Please register again." };
  }
  const { data: slugTaken } = await adminClient
    .from("teams")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (slugTaken) {
    return { error: "A team with this name already exists. Please register again with a different name." };
  }

  // Create president account
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: presidentEmail,
    password: plaintextPassword,
    email_confirm: true,
    user_metadata: { name: presidentName },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Failed to create account." };
  }

  const userId = authData.user.id;

  // Create profile
  await adminClient.from("profiles").upsert({
    id: userId,
    email: presidentEmail,
    name: presidentName,
    role: "participant",
  });

  // Create team
  const { data: team, error: teamError } = await adminClient
    .from("teams")
    .insert({
      name: teamName,
      slug,
      university,
      city,
      president_user_id: userId,
      status: "active",
    })
    .select()
    .single();

  if (teamError || !team) {
    return { error: teamError?.message || "Failed to create team." };
  }

  // Add president as team member
  await adminClient.from("team_members").insert({
    team_id: team.id,
    user_id: userId,
    role: "president",
  });

  logEvent({
    action: "registration.team_completed",
    entityType: "team",
    entityId: team.id as string,
    actorType: "participant",
    delta: { created: { team_name: teamName, president_email: presidentEmail } },
  });

  // Send invite emails to members instead of creating their accounts
  for (const member of members) {
    const { data: invite } = await adminClient
      .from("team_invites")
      .insert({
        team_id: team.id,
        email: member.email.toLowerCase(),
        name: member.name,
        invited_by: userId,
      })
      .select("token")
      .single();

    if (invite) {
      const inviteHtml = await renderTeamInviteEmail({
        recipientName: member.name,
        recipientEmail: member.email,
        teamName,
        inviterName: presidentName,
        inviteToken: invite.token as string,
      });

      sendEmailAfterResponse(`team invite to ${member.email}`, () =>
        sendEmail({
          to: member.email,
          subject: `Join ${teamName} in the European Hackathon League`,
          html: inviteHtml,
        })
      );
    }
  }

  // Send welcome email to president
  sendEmailAfterResponse(`welcome emails for ${teamName}`, () =>
    sendWelcomeEmails({ teamName, presidentName, presidentEmail, members })
  );

  // Delete the consumed verification record (encrypted password no longer needed).
  await adminClient.from("verification_codes").delete().eq("id", verificationId);

  // Sign in the president
  await supabase.auth.signInWithPassword({
    email: presidentEmail,
    password: plaintextPassword,
  });

  const safeRedirect = getSafeRedirect(redirectTo);
  if (safeRedirect) {
    redirect(safeRedirect);
  }

  redirect("/dashboard");
}

async function sendWelcomeEmails({
  teamName,
  presidentName,
  presidentEmail,
  members,
}: {
  teamName: string;
  presidentName: string;
  presidentEmail: string;
  members: { name: string; email: string }[];
}) {
  const presidentHtml = await renderWelcomeEmail({
    teamName,
    presidentName,
    members,
    isPresident: true,
    recipientName: presidentName,
  });
  await sendEmail({
    to: presidentEmail,
    subject: `Welcome to the EHL, ${presidentName}!`,
    html: presidentHtml,
  });
}
