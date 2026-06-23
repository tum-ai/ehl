/**
 * E2E test data factory.
 * Creates test entities via Supabase admin API.
 * All entities use e2e-* naming convention for easy cleanup.
 */
import { getAdminClient, getSiteUrl } from "../fixtures/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const TEST_PASSWORD = "TestPass123!";

// ─── Helpers ───────────────────────────────────────────────

/**
 * Find an auth user by email. Handles Supabase pagination (default 50 per page)
 * by paginating through all users. Returns the user or undefined.
 */
async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<{ id: string; email?: string } | undefined> {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage });
    const users = data?.users ?? [];
    const found = users.find((u) => u.email === email);
    if (found) return found;
    if (users.length < perPage) break; // Last page
    page++;
  }
  return undefined;
}

// ─── Auth User Creation ────────────────────────────────────

/**
 * Create a participant auth user + profile. Returns the user ID.
 * Idempotent: if the user already exists, updates the profile.
 */
export async function createParticipant(opts: {
  email: string;
  name: string;
  lookingForTeam?: boolean;
}) {
  const admin = getAdminClient();

  // Check if auth user already exists (paginated - default is 50, we need to search properly)
  const existing = await findAuthUserByEmail(admin, opts.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    // Update password in case it changed
    await admin.auth.admin.updateUserById(userId, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: opts.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: opts.name },
    });
    if (error) throw new Error(`Failed to create participant ${opts.email}: ${error.message}`);
    userId = data.user.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: "participant",
    looking_for_team: opts.lookingForTeam ?? false,
  });

  return userId;
}

/**
 * Create a participant the way bulk imports do: auth user WITHOUT a
 * password + profile. These users can only get access via the password
 * recovery flow. Returns the user ID.
 * Idempotent: deletes any existing user with this email first so the
 * "no password" state is guaranteed.
 */
export async function createImportedParticipant(opts: {
  email: string;
  name: string;
}) {
  const admin = getAdminClient();

  const existing = await findAuthUserByEmail(admin, opts.email);
  if (existing) {
    await admin.from("profiles").delete().eq("id", existing.id);
    await admin.auth.admin.deleteUser(existing.id);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    email_confirm: true,
    user_metadata: { name: opts.name },
  });
  if (error) throw new Error(`Failed to create imported participant ${opts.email}: ${error.message}`);
  const userId = data.user.id;

  await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: "participant",
  });

  return userId;
}

/**
 * Create an admin auth user + profile. Returns the user ID.
 * Idempotent: if the user already exists, updates the profile.
 *
 * Note: The auth callback checks existing profile.role == 'admin'
 * first, so e2e admin users work without being in admin_emails table.
 */
export async function createAdmin(opts: {
  email: string;
  name: string;
}) {
  const admin = getAdminClient();

  const existing = await findAuthUserByEmail(admin, opts.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
      user_metadata: { name: opts.name },
    });
    if (error) throw new Error(`Failed to create admin ${opts.email}: ${error.message}`);
    userId = data.user.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: "admin",
  });

  return userId;
}

/**
 * Create a jury auth user + profile. Returns the user ID.
 * Idempotent: if the user already exists, updates the profile.
 */
export async function createJury(opts: {
  email: string;
  name: string;
}) {
  const admin = getAdminClient();

  const existing = await findAuthUserByEmail(admin, opts.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
      user_metadata: { name: opts.name },
    });
    if (error) throw new Error(`Failed to create jury ${opts.email}: ${error.message}`);
    userId = data.user.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: "jury",
  });

  return userId;
}

/**
 * Create a local (chapter) admin: an account scoped to a single chapter via the
 * chapter_admins table. Mirrors how inviteChapterAdmin() provisions one.
 */
export async function createChapterAdmin(opts: {
  email: string;
  name: string;
  chapterId: string;
}) {
  const admin = getAdminClient();

  const existing = await findAuthUserByEmail(admin, opts.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
      user_metadata: { name: opts.name },
    });
    if (error)
      throw new Error(`Failed to create chapter admin ${opts.email}: ${error.message}`);
    userId = data.user.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: "chapter_admin",
  });

  await admin
    .from("chapter_admins")
    .upsert({ user_id: userId, chapter_id: opts.chapterId });

  return userId;
}

// ─── Magic Link Generation ─────────────────────────────────

/**
 * Generate a magic link URL for a user. Works for admin and jury auth.
 * Returns the full callback URL to navigate to.
 */
export async function generateMagicLink(
  email: string,
  redirectPath: string
): Promise<string> {
  const admin = getAdminClient();
  const siteUrl = getSiteUrl();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=${redirectPath}`,
    },
  });

  if (error || !data.properties?.hashed_token) {
    throw new Error(`Failed to generate magic link for ${email}: ${error?.message}`);
  }

  return `${siteUrl}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&next=${redirectPath}`;
}

/**
 * Generate a password recovery link routed through the auth callback,
 * exactly like requestPasswordReset() builds it. Lets tests cover the
 * recovery flow without receiving email.
 */
export async function generateRecoveryLink(email: string): Promise<string> {
  const admin = getAdminClient();
  const siteUrl = getSiteUrl();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: `${siteUrl}/reset-password`,
    },
  });

  if (error || !data.properties?.hashed_token) {
    throw new Error(`Failed to generate recovery link for ${email}: ${error?.message}`);
  }

  return `${siteUrl}/auth/callback?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`;
}

// ─── Team Creation ──────────────────────────────────────────

/**
 * Create a team and add the president as a member.
 */
export async function createTeam(opts: {
  name: string;
  presidentUserId: string;
  university?: string;
  city?: string;
}) {
  const admin = getAdminClient();
  const slug = opts.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Defensively delete any leftover team with the same slug (from a failed previous run).
  const { data: existing } = await admin.from("teams").select("id").eq("slug", slug);
  if (existing && existing.length > 0) {
    const ids = existing.map((t) => t.id as string);
    await admin.from("team_members").delete().in("team_id", ids);
    await admin.from("teams").delete().in("id", ids);
  }

  const { data: team, error } = await admin
    .from("teams")
    .insert({
      name: opts.name,
      slug,
      university: opts.university ?? null,
      city: opts.city ?? null,
      president_user_id: opts.presidentUserId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create team ${opts.name}: ${error.message}`);

  await admin.from("team_members").insert({
    team_id: team.id,
    user_id: opts.presidentUserId,
    role: "president",
  });

  return team.id as string;
}

/**
 * Add a member to a team.
 */
export async function addTeamMember(teamId: string, userId: string) {
  const admin = getAdminClient();
  await admin.from("team_members").insert({
    team_id: teamId,
    user_id: userId,
    role: "member",
  });
}

// ─── Chapter Creation ───────────────────────────────────────

/**
 * Create a chapter in draft status. Returns the chapter ID and slug.
 */
export async function createChapter(opts: {
  name: string;
  city: string;
  country: string;
  countryCode?: string;
  description: string;
  date: string;
  dateEnd: string;
  matchNumber?: number;
}) {
  const admin = getAdminClient();
  const slug = opts.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Defensively delete any leftover chapter with the same slug (from failed previous runs)
  const { data: existing } = await admin.from("chapters").select("id").eq("slug", slug);
  if (existing && existing.length > 0) {
    const existingIds = existing.map((c) => c.id as string);
    const { data: challenges } = await admin.from("challenges").select("id").in("chapter_id", existingIds);
    const challengeIds = (challenges ?? []).map((c) => c.id as string);
    if (challengeIds.length > 0) {
      await admin.from("jury_rankings").delete().in("challenge_id", challengeIds);
      await admin.from("jury_feedback").delete().in("challenge_id", challengeIds);
      await admin.from("submissions").delete().in("challenge_id", challengeIds);
      await admin.from("challenge_registrations").delete().in("challenge_id", challengeIds);
    }
    await admin.from("jury_assignments").delete().in("chapter_id", existingIds);
    await admin.from("challenges").delete().in("chapter_id", existingIds);
    await admin.from("scores").delete().in("chapter_id", existingIds);
    await admin.from("media").delete().in("chapter_id", existingIds);
    await admin.from("partners").delete().in("chapter_id", existingIds);
    await admin.from("team_join_requests").delete().in("chapter_id", existingIds);
    await admin.from("chapters").delete().in("id", existingIds);
  }

  const { data, error } = await admin
    .from("chapters")
    .insert({
      name: opts.name,
      slug,
      city: opts.city,
      country: opts.country,
      country_code: opts.countryCode ?? "DE",
      description: opts.description,
      date: opts.date,
      date_end: opts.dateEnd,
      status: "draft",
      match_number: opts.matchNumber ?? 99,
      challenge_registration_enabled: true,
    })
    .select("id, slug")
    .single();

  if (error) throw new Error(`Failed to create chapter ${opts.name}: ${error.message}`);

  return { id: data.id as string, slug: data.slug as string };
}

/**
 * Update chapter status directly in DB.
 */
export async function setChapterStatus(
  chapterId: string,
  status: string
) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("chapters")
    .update({ status })
    .eq("id", chapterId);

  if (error) throw new Error(`Failed to set chapter status to ${status}: ${error.message}`);
}

/**
 * Set chapter deadlines.
 */
export async function setChapterDeadlines(
  chapterId: string,
  deadlines: {
    applicationDeadline?: string;
    challengeSelectionDeadline?: string;
    submissionDeadline?: string;
  }
) {
  const admin = getAdminClient();
  const update: Record<string, string> = {};
  if (deadlines.applicationDeadline)
    update.application_deadline = deadlines.applicationDeadline;
  if (deadlines.challengeSelectionDeadline)
    update.challenge_selection_deadline = deadlines.challengeSelectionDeadline;
  if (deadlines.submissionDeadline)
    update.submission_deadline = deadlines.submissionDeadline;

  const { error } = await admin
    .from("chapters")
    .update(update)
    .eq("id", chapterId);

  if (error) throw new Error(`Failed to set deadlines: ${error.message}`);
}

// ─── Challenge Creation ─────────────────────────────────────

/**
 * Create a challenge for a chapter.
 */
export async function createChallenge(opts: {
  chapterId: string;
  title: string;
  description?: string;
  sponsorName?: string;
  isScored?: boolean;
  entireRequired?: boolean;
  submissionFields?: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
  }>;
}) {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("challenges")
    .insert({
      chapter_id: opts.chapterId,
      title: opts.title,
      description: opts.description ?? "E2E test challenge",
      sponsor_name: opts.sponsorName ?? null,
      is_scored: opts.isScored ?? true,
      entire_required: opts.entireRequired ?? false,
      submission_fields: opts.submissionFields ?? [
        {
          key: "repo",
          label: "GitHub Repository",
          type: "url",
          required: true,
          placeholder: "https://github.com/...",
        },
      ],
      display_order: 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create challenge ${opts.title}: ${error.message}`);
  return data.id as string;
}

// ─── Chapter Unlocks ────────────────────────────────────────

// ─── Challenge Registration ─────────────────────────────────

/**
 * Register a team for a challenge.
 */
export async function registerForChallenge(opts: {
  chapterId: string;
  challengeId: string;
  teamId: string;
  roster: string[];
}) {
  const admin = getAdminClient();
  const { error } = await admin.from("challenge_registrations").insert({
    chapter_id: opts.chapterId,
    challenge_id: opts.challengeId,
    team_id: opts.teamId,
    roster: opts.roster,
  });

  if (error) throw new Error(`Failed to register for challenge: ${error.message}`);
}

// ─── Jury Assignment ────────────────────────────────────────

/**
 * Assign a jury member to a challenge.
 */
export async function assignJury(opts: {
  userId: string;
  challengeId: string;
  chapterId: string;
}) {
  const admin = getAdminClient();
  const { error } = await admin.from("jury_assignments").upsert({
    user_id: opts.userId,
    challenge_id: opts.challengeId,
    chapter_id: opts.chapterId,
    status: "pending",
  });

  if (error) throw new Error(`Failed to assign jury: ${error.message}`);
}

// ─── DB Read Helpers ────────────────────────────────────────

/**
 * Read verification code from DB (for registration tests).
 */
export async function getVerificationCode(email: string): Promise<string> {
  const admin = getAdminClient();
  const normalizedEmail = email.trim().toLowerCase();

  // Retry a few times - the server action writes the code after the SMTP send completes,
  // which can take several seconds for non-existent domains.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    const { data } = await admin
      .from("verification_codes")
      .select("code")
      .eq("email", normalizedEmail)
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data?.code) {
      return data.code as string;
    }
  }

  throw new Error(`No verification code found for ${email} after 20s`);
}

/**
 * Read team invite token from DB (for member registration tests).
 */
export async function getTeamInviteToken(email: string): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("team_invites")
    .select("token")
    .eq("email", email.trim().toLowerCase())
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`No team invite found for ${email}: ${error?.message}`);
  }

  return data.token as string;
}

/**
 * Get a profile by email.
 */
export async function getProfileByEmail(email: string) {
  const admin = getAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, name, email, role, looking_for_team")
    .eq("email", email.trim().toLowerCase())
    .single();
  return data;
}

/**
 * Get a team by name.
 */
export async function getTeamByName(name: string) {
  const admin = getAdminClient();
  const { data } = await admin
    .from("teams")
    .select("id, name, slug, president_user_id")
    .eq("name", name)
    .single();
  return data;
}
