/**
 * Simulation slice 7: real-UI scoring + public results.
 *
 * Building on the jury flow, the admin finalizes jury voting (real admin jury
 * UI), which generates scores, then publishes results on the real admin scores
 * page (which marks the chapter completed). We then assert the public
 * /leaderboard and /matches pages reflect the result through the UI.
 *
 * Preconditions with no dedicated UI of their own (the submitted team, and the
 * jury vote) are set via the admin client + a real jury vote; the slice's
 * subject — finalize, publish, and public display — is all real UI.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  createChallengeViaUI,
  advanceChapterStatusViaUI,
  getChallengeId,
  bootstrapSubmission,
  assignJuryViaUI,
  juryLoginViaUI,
  submitSingleTeamRankingViaUI,
  registerSoloViaUI,
  simEmail,
  adminClient,
  clearMailbox,
  cleanupSimData,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Scoring Match";
const CHALLENGE_TITLE = "Sim Scoring Challenge";
const TEAM_PRESIDENT = simEmail("sim-score-pres");
const JURY_EMAIL = simEmail("sim-score-jury");
const TEAM_NAME = "Sim Champions";

test.describe("Simulation: scoring + leaderboard (real UI)", () => {
  let chapterId: string;
  let slug: string;
  let challengeId: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin sets up a pitched chapter with a jury vote", async ({ page, browser }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    chapterId = created.id;
    await createChallengeViaUI(page, chapterId, { title: CHALLENGE_TITLE });
    challengeId = await getChallengeId(chapterId, CHALLENGE_TITLE);

    const db = adminClient();
    const { data: chapter } = await db.from("chapters").select("slug").eq("id", chapterId).single();
    slug = chapter!.slug as string;

    const presCtx = await browser.newContext();
    await registerSoloViaUI(await presCtx.newPage(), { name: "Sim Score Pres", email: TEAM_PRESIDENT });
    await presCtx.close();
    const { data: pres } = await db.from("profiles").select("id").eq("email", TEAM_PRESIDENT).single();

    await bootstrapSubmission({
      chapterId,
      challengeId,
      teamName: TEAM_NAME,
      presidentUserId: pres!.id as string,
      projectName: "Sim Champion Project",
    });

    await assignJuryViaUI(page, {
      chapterId,
      challengeId,
      juryName: "Sim Score Jury",
      juryEmail: JURY_EMAIL,
    });
    await advanceChapterStatusViaUI(page, chapterId, "pitching");

    // Jury submits a ranking through the real jury UI (so finalize has a vote).
    const juryCtx = await browser.newContext();
    const juryPage = await juryCtx.newPage();
    await juryLoginViaUI(juryPage, JURY_EMAIL);
    await submitSingleTeamRankingViaUI(juryPage, { slug, teamName: TEAM_NAME });
    await juryCtx.close();

    await expect
      .poll(async () => {
        const { count } = await db
          .from("jury_rankings")
          .select("id", { count: "exact", head: true })
          .eq("challenge_id", challengeId);
        return count ?? 0;
      }, { timeout: 15000 })
      .toBe(1);
  });

  test("admin finalizes voting and publishes scores via the real UI", async ({ page }) => {
    // The admin jury page loads every chapter's challenges + progress, so it can
    // be slow to become interactive; give this step extra headroom.
    test.setTimeout(180_000);
    await adminLoginViaSession(page);
    page.on("dialog", (d) => d.accept());

    const db = adminClient();

    // Finalize jury voting on the real admin jury page (generates scores). The
    // page loads each challenge's progress asynchronously, so wait for our
    // challenge's Finalize button to render, then click it.
    await page.goto("/admin/jury");
    await page.waitForLoadState("networkidle").catch(() => {});
    const heading = page.getByRole("heading", { name: CHALLENGE_TITLE, exact: true }).first();
    await expect(heading).toBeVisible({ timeout: 20000 });
    const finalizeBtn = heading.locator(
      'xpath=ancestor::div[.//button[contains(normalize-space(.),"Finalize Voting")]][1]//button[contains(normalize-space(.),"Finalize Voting")]'
    );
    await expect(finalizeBtn).toBeEnabled({ timeout: 20000 });
    await finalizeBtn.click();

    // The finalize server action aggregates votes + upserts scores. Poll the
    // scores table directly (the real signal) with generous headroom — the
    // action can be slow under load.
    await expect
      .poll(async () => {
        // scores' PK is (chapter_id, team_id); there is no id column.
        const { data } = await db.from("scores").select("team_id").eq("chapter_id", chapterId);
        return (data ?? []).length;
      }, { timeout: 60000, intervals: [1500] })
      .toBeGreaterThan(0);

    // Publish results on the real admin scores page.
    await page.goto(`/admin/chapters/${chapterId}/scores`);
    await page.getByRole("button", { name: /publish results/i }).click();

    await expect
      .poll(async () => {
        const { data } = await db.from("chapters").select("status").eq("id", chapterId).single();
        return data?.status ?? null;
      }, { timeout: 15000 })
      .toBe("completed");

    const { data: published } = await db
      .from("scores")
      .select("published")
      .eq("chapter_id", chapterId)
      .limit(1)
      .single();
    expect(published?.published).toBe(true);
  });

  test("the public leaderboard and matches pages show the result", async ({ page }) => {
    // Leaderboard: the team appears in the standings with its score.
    await page.goto("/leaderboard");
    await expect(page.getByText(TEAM_NAME).first()).toBeVisible({ timeout: 20000 });

    // Matches: the tour timeline lists the completed chapter (rendered by city).
    await page.goto("/matches");
    await expect(page.getByText("Sim City").first()).toBeVisible({ timeout: 20000 });

    // The chapter's public match page shows the published result (team name).
    await page.goto(`/matches/${slug}`);
    await expect(page.getByText(TEAM_NAME).first()).toBeVisible({ timeout: 20000 });
  });
});
