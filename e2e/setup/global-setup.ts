/**
 * Playwright global setup: creates E2E test users and verifies auth works.
 * Runs once before all test projects.
 *
 * Creates:
 * - 1 admin user (magic link auth shortcut, bypasses Google OAuth)
 * - 2 jury users
 * - 1 solo participant (will become E2E Beta team president)
 * - 1 team president participant (E2E Alpha)
 * - 1 team member participant
 *
 * Also creates E2E Beta team for cross-team testing.
 *
 * Note: StorageState is NOT saved. The lifecycle tests re-authenticate
 * for each test via loginAsAdmin/loginAsParticipant/loginAsJury.
 * This is intentional: it tests the auth flow each time and avoids
 * stale JWT issues on long test runs.
 */
import { test as setup } from "@playwright/test";
import { cleanupE2EData } from "../helpers/cleanup";
import {
  createAdmin,
  createJury,
  createParticipant,
  createTeam,
} from "../helpers/data-factory";
import {
  loginAsAdmin,
  loginAsParticipant,
  E2E_ACCOUNTS,
  TEST_PASSWORD,
} from "../helpers/auth";

setup("cleanup stale E2E data", async () => {
  await cleanupE2EData();
});

setup("create E2E test users and teams", async () => {
  // Admin
  await createAdmin({
    email: E2E_ACCOUNTS.admin.email,
    name: E2E_ACCOUNTS.admin.name,
  });

  // Participants
  await createParticipant({
    email: E2E_ACCOUNTS.president.email,
    name: E2E_ACCOUNTS.president.name,
  });

  await createParticipant({
    email: E2E_ACCOUNTS.member.email,
    name: E2E_ACCOUNTS.member.name,
  });

  const soloUserId = await createParticipant({
    email: E2E_ACCOUNTS.solo.email,
    name: E2E_ACCOUNTS.solo.name,
    lookingForTeam: true,
  });

  // Jury
  await createJury({
    email: E2E_ACCOUNTS.jury1.email,
    name: E2E_ACCOUNTS.jury1.name,
  });

  await createJury({
    email: E2E_ACCOUNTS.jury2.email,
    name: E2E_ACCOUNTS.jury2.name,
  });

  // Create E2E Beta team with solo user as president (for cross-team tests)
  await createTeam({
    name: "E2E Beta",
    presidentUserId: soloUserId,
    university: "E2E University",
    city: "E2E City",
  });
});

setup("verify admin auth works", async ({ page }) => {
  await loginAsAdmin(page);
  // If we get here without timeout, admin auth is working
});

setup("verify participant auth works", async ({ page }) => {
  await loginAsParticipant(page, E2E_ACCOUNTS.president.email, TEST_PASSWORD);
  // If we get here without timeout, participant auth is working
});
