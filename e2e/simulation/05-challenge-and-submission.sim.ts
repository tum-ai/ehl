/**
 * Simulation slice 5: real-UI challenge registration + project submission.
 *
 * Admin creates a chapter + challenge through the real admin UI and walks the
 * chapter through the status flow with the real status control. A two-person,
 * checked-in team (check-in is bootstrapped via the admin client — it has no
 * participant UI) registers for the challenge on the real event hub, then
 * submits a project through the real submission form on the match page.
 *
 * The challenge uses a plain URL submission field (no GitHub repo) so the flow
 * never depends on the live GitHub API. We assert the submission row exists.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  createChallengeViaUI,
  advanceChapterStatusViaUI,
  bootstrapCheckedInTeam,
  getChallengeId,
  registerSoloViaUI,
  loginViaUI,
  simEmail,
  adminClient,
  clearMailbox,
  cleanupSimData,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Submission Match";
const CHALLENGE_TITLE = "Sim AI Challenge";
const PRESIDENT = simEmail("sim-sub-president");
const MEMBER = simEmail("sim-sub-member");
const TEAM_NAME = "Sim Builders";

test.describe("Simulation: challenge registration + submission (real UI)", () => {
  let chapterId: string;
  let slug: string;
  let challengeId: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin sets up chapter, challenge, and a checked-in team", async ({ page, browser }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    chapterId = created.id;
    await createChallengeViaUI(page, chapterId, { title: CHALLENGE_TITLE });
    challengeId = await getChallengeId(chapterId, CHALLENGE_TITLE);

    const db = adminClient();
    const { data: chapter } = await db.from("chapters").select("slug").eq("id", chapterId).single();
    slug = chapter!.slug as string;

    // Two real registered participants (registered through the real UI).
    const presCtx = await browser.newContext();
    await registerSoloViaUI(await presCtx.newPage(), { name: "Sim Sub President", email: PRESIDENT });
    await presCtx.close();
    const memCtx = await browser.newContext();
    await registerSoloViaUI(await memCtx.newPage(), { name: "Sim Sub Member", email: MEMBER });
    await memCtx.close();

    const { data: presProfile } = await db.from("profiles").select("id").eq("email", PRESIDENT).single();
    const { data: memProfile } = await db.from("profiles").select("id").eq("email", MEMBER).single();

    // Bootstrap accepted + checked-in team (no participant check-in UI exists).
    await bootstrapCheckedInTeam({
      chapterId,
      teamName: TEAM_NAME,
      members: [
        { userId: presProfile!.id as string, email: PRESIDENT },
        { userId: memProfile!.id as string, email: MEMBER },
      ],
    });

    // Move the chapter to challenge_selection so the event hub allows registration.
    await advanceChapterStatusViaUI(page, chapterId, "challenge_selection");
    const { data: after } = await db.from("chapters").select("status").eq("id", chapterId).single();
    expect(after?.status).toBe("challenge_selection");
  });

  test("president registers the team for the challenge on the real event hub", async ({ page }) => {
    await loginViaUI(page, PRESIDENT);
    await page.goto(`/event/${slug}`);

    // Step 3 challenge selector: click the challenge, roster auto-includes the
    // two checked-in members, then register.
    const challengeBtn = page.getByRole("button", { name: new RegExp(CHALLENGE_TITLE, "i") });
    await expect(challengeBtn).toBeVisible({ timeout: 20000 });
    await challengeBtn.click();
    await page.getByRole("button", { name: /register for challenge/i }).click();

    // DB confirms the registration.
    const db = adminClient();
    await expect
      .poll(async () => {
        const { count } = await db
          .from("challenge_registrations")
          .select("id", { count: "exact", head: true })
          .eq("chapter_id", chapterId)
          .eq("challenge_id", challengeId);
        return count ?? 0;
      }, { timeout: 15000 })
      .toBe(1);
  });

  test("admin opens submissions and the team submits a project via the real form", async ({ page }) => {
    // Advance to submissions_open (needs the registration that now exists).
    await adminLoginViaSession(page);
    await advanceChapterStatusViaUI(page, chapterId, "submissions_open", { from: "challenge_selection" });

    const db = adminClient();
    const { data: chapterStatus } = await db.from("chapters").select("status").eq("id", chapterId).single();
    expect(chapterStatus?.status).toBe("submissions_open");

    // President submits through the real submission form on the match page.
    await loginViaUI(page, PRESIDENT);
    await page.goto(`/matches/${slug}`);

    await expect(page.getByRole("heading", { name: /submit project/i })).toBeVisible({ timeout: 20000 });
    await page.locator('input[placeholder="Your project name"]').fill("Sim Project X");
    await page
      .locator('textarea[placeholder="What does your project do?"]')
      .fill("A sim project built end to end through the real UI.");
    // The single dynamic URL field ("Demo URL").
    await page.locator('input[type="url"]').first().fill("https://demo.sim-ehl.com/project-x");
    await page
      .locator('input[placeholder="e.g. Next.js, Python, OpenAI API"]')
      .fill("Next.js, TypeScript");

    await page.getByRole("button", { name: /^submit project$/i }).click();
    await expect(page.getByText(/submission saved successfully/i)).toBeVisible({ timeout: 20000 });

    // DB confirms the submission row.
    const { data: submission } = await db
      .from("submissions")
      .select("id, project_name, challenge_id")
      .eq("challenge_id", challengeId)
      .maybeSingle();
    expect(submission, "submission row should exist").toBeTruthy();
    expect(submission!.project_name).toBe("Sim Project X");
  });
});
