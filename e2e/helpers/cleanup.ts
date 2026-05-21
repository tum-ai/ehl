/**
 * E2E test data cleanup.
 * Deletes all test entities created with the e2e-* naming convention.
 * Safe to run multiple times (idempotent).
 * NEVER touches seed data.
 */
import { getAdminClient } from "../fixtures/supabase-admin";

const E2E_EMAIL_PATTERN = "%@test-ehl.com";
const E2E_NAME_PATTERN = "E2E %";

export async function cleanupE2EData() {
  const admin = getAdminClient();

  // 1. Find all e2e profiles to get user IDs
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .like("email", E2E_EMAIL_PATTERN);

  const profileIds = (profiles ?? []).map((p) => p.id as string);
  const profileEmails = (profiles ?? []).map((p) => p.email as string);

  // 2. Find e2e chapters
  const { data: chapters } = await admin
    .from("chapters")
    .select("id")
    .like("name", E2E_NAME_PATTERN);

  const chapterIds = (chapters ?? []).map((c) => c.id as string);

  // 3. Find e2e teams
  const { data: teams } = await admin
    .from("teams")
    .select("id")
    .like("name", E2E_NAME_PATTERN);

  const teamIds = (teams ?? []).map((t) => t.id as string);

  // 4. Find challenges in e2e chapters
  let challengeIds: string[] = [];
  if (chapterIds.length > 0) {
    const { data: challenges } = await admin
      .from("challenges")
      .select("id")
      .in("chapter_id", chapterIds);
    challengeIds = (challenges ?? []).map((c) => c.id as string);
  }

  // Delete in reverse dependency order
  if (challengeIds.length > 0) {
    await admin.from("pitch_orders").delete().in("challenge_id", challengeIds);
    await admin.from("jury_feedback").delete().in("challenge_id", challengeIds);
    await admin.from("jury_rankings").delete().in("challenge_id", challengeIds);
    await admin.from("code_reviews").delete().in("challenge_id", challengeIds);
    await admin.from("submissions").delete().in("challenge_id", challengeIds);
    await admin
      .from("challenge_registrations")
      .delete()
      .in("challenge_id", challengeIds);
  }

  if (profileIds.length > 0) {
    await admin
      .from("jury_assignments")
      .delete()
      .in("user_id", profileIds);
  }

  if (chapterIds.length > 0) {
    await admin
      .from("jury_assignments")
      .delete()
      .in("chapter_id", chapterIds);
    await admin
      .from("challenges")
      .delete()
      .in("chapter_id", chapterIds);
    await admin.from("scores").delete().in("chapter_id", chapterIds);
    await admin.from("media").delete().in("chapter_id", chapterIds);
    await admin.from("partners").delete().in("chapter_id", chapterIds);
  }

  // Delete applications by e2e emails
  if (profileEmails.length > 0) {
    // First find application IDs for screening scores
    const { data: apps } = await admin
      .from("applications")
      .select("id")
      .in("email", profileEmails);
    const appIds = (apps ?? []).map((a) => a.id as string);
    if (appIds.length > 0) {
      await admin.from("screening_scores").delete().in("application_id", appIds);
    }
    await admin.from("applications").delete().in("email", profileEmails);
  }

  // Also delete applications with e2e pattern directly
  const { data: e2eApps } = await admin
    .from("applications")
    .select("id")
    .like("email", E2E_EMAIL_PATTERN);
  const e2eAppIds = (e2eApps ?? []).map((a) => a.id as string);
  if (e2eAppIds.length > 0) {
    await admin.from("screening_scores").delete().in("application_id", e2eAppIds);
    await admin.from("applications").delete().like("email", E2E_EMAIL_PATTERN);
  }

  // Delete chapters
  if (chapterIds.length > 0) {
    await admin.from("chapters").delete().in("id", chapterIds);
  }

  // Delete team-related data
  if (teamIds.length > 0) {
    await admin.from("team_join_requests").delete().in("team_id", teamIds);
    await admin.from("team_invites").delete().in("team_id", teamIds);
    await admin.from("team_members").delete().in("team_id", teamIds);
    await admin.from("teams").delete().in("id", teamIds);
  }

  // Delete verification codes
  await admin
    .from("verification_codes")
    .delete()
    .like("email", E2E_EMAIL_PATTERN);

  // Note: admin_emails domain is validated in application code (ADMIN_EMAIL_DOMAIN env var).
  // so e2e-* emails can never exist there. No cleanup needed.

  // Delete profiles
  if (profileIds.length > 0) {
    await admin.from("profiles").delete().in("id", profileIds);
  }

  // Delete auth users - first by profile IDs, then scan for any orphaned e2e auth users
  for (const id of profileIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // User might not exist in auth, that's OK
    }
  }

  // Also find and delete orphaned auth users (profiles deleted but auth.users remain)
  // Paginate through all users since listUsers() defaults to 50 per page
  try {
    const orphanedE2E: { id: string }[] = [];
    let page = 1;
    while (true) {
      const { data: { users } } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      for (const u of users ?? []) {
        if (u.email?.endsWith("@test-ehl.com")) orphanedE2E.push(u);
      }
      if (!users || users.length < 100) break;
      page++;
    }
    for (const u of orphanedE2E) {
      try {
        await admin.auth.admin.deleteUser(u.id);
      } catch {
        // Ignore errors
      }
    }
    if (orphanedE2E.length > 0) {
      console.log(`[E2E Cleanup] Deleted ${orphanedE2E.length} orphaned auth users`);
    }
  } catch {
    // listUsers might fail in some environments
  }

  console.log(
    `[E2E Cleanup] Removed ${profileIds.length} profiles, ${teamIds.length} teams, ${chapterIds.length} chapters, ${challengeIds.length} challenges`
  );
}
