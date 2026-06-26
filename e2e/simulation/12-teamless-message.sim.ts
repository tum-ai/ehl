/**
 * Simulation slice 12: teamless-participant message during challenge selection (#34).
 *
 * Regression for #34: during challenge_selection, a LOGGED-IN participant who is
 * not yet on a team was shown the LOGGED-OUT "Log in to see your team status"
 * prompt, because the message only branched on userRole (null both when logged
 * out AND when logged in without a team). The fix threads an isLoggedIn flag so a
 * logged-in teamless participant is told to join/create a team instead.
 *
 * This drives the real public match page (/matches/<slug>) as a real logged-in
 * teamless participant and asserts the correct message — and the absence of the
 * logged-out one.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  createChallengeViaUI,
  advanceChapterStatusViaUI,
  registerSoloViaUI,
  loginViaUI,
  simEmail,
  adminClient,
  cleanupSimData,
  clearMailbox,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Teamless Match";
const CHALLENGE_TITLE = "Sim Teamless Challenge";
const TEAMLESS_EMAIL = simEmail("sim-teamless");

const LOGGED_IN_TEAMLESS = "You're not on a team yet";
const LOGGED_OUT_PROMPT = "Log in to see your team status";

test.describe("Simulation: teamless participant message in challenge selection (real UI)", () => {
  let slug: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  // This slice creates a chapter that sits in challenge_selection (an event
  // status). Clean it up so it does not linger as an "active" sim chapter in the
  // shared test DB, where it would make /admin/teams render a challenge <select>
  // in every row and break standalone reruns of other slices (e.g. slice 11).
  test.afterAll(async () => {
    await cleanupSimData();
  });

  test("admin creates a challenge_selection chapter", async ({ page }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    const chapterId = created.id;
    // challenge_selection needs >= 1 challenge to be a valid target.
    await createChallengeViaUI(page, chapterId, { title: CHALLENGE_TITLE });
    await advanceChapterStatusViaUI(page, chapterId, "challenge_selection");

    const db = adminClient();
    const { data: chapter } = await db
      .from("chapters")
      .select("slug, status")
      .eq("id", chapterId)
      .single();
    slug = chapter!.slug as string;
    expect(chapter!.status).toBe("challenge_selection");
  });

  test("a logged-in teamless participant is told to join/create a team, NOT to log in (#34)", async ({ browser }) => {
    // A real registered participant who is NOT on any team.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await registerSoloViaUI(page, { name: "Sim Teamless", email: TEAMLESS_EMAIL });
    // Ensure a clean logged-in session via the real login form.
    await loginViaUI(page, TEAMLESS_EMAIL);

    await page.goto(`/matches/${slug}`);

    // The challenge-selection panel must tell a logged-in teamless participant to
    // join or create a team (the #34 fix), and must NOT show the logged-out prompt.
    await expect(page.getByText(new RegExp(LOGGED_IN_TEAMLESS, "i"))).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(new RegExp(LOGGED_OUT_PROMPT, "i"))).toHaveCount(0);

    await ctx.close();
  });

  test("a LOGGED-OUT visitor still sees the log-in prompt (control)", async ({ browser }) => {
    // Control: the same panel for a logged-out visitor must show the log-in prompt
    // (proving the message genuinely branches on the session, not always one text).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/matches/${slug}`);
    await expect(page.getByText(new RegExp(LOGGED_OUT_PROMPT, "i"))).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(new RegExp(LOGGED_IN_TEAMLESS, "i"))).toHaveCount(0);
    await ctx.close();
  });
});
