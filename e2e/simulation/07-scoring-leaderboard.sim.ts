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
import { test, expect, request as playwrightRequest } from "@playwright/test";
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
import { certificateToken } from "@/lib/certificate-token";

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

  test("scores page truthfully warns when jury results are shown but NOT finalized (#39)", async ({ page }) => {
    // Regression for the publish-readiness divergence (#39): the admin scores
    // page reads DISPLAYED jury results from a live aggregation of jury_rankings,
    // but publish only surfaces rows persisted in `scores`. Before finalize there
    // is a jury ranking (displayed) but NO `scores` row, so the page must warn
    // that those teams will NOT be published — NOT falsely claim "no scores yet"
    // and NOT silently drop them. (The unit tests cover getPublishReadiness; this
    // asserts the real page wires the live jury aggregation into that warning.)
    const db = adminClient();
    // Guard the precondition this regression depends on: a displayed jury ranking
    // exists, but finalization has not yet written any `scores` row.
    const { count: rankings } = await db
      .from("jury_rankings")
      .select("id", { count: "exact", head: true })
      .eq("challenge_id", challengeId);
    expect(rankings, "a jury ranking is displayed").toBe(1);
    const { data: preScores } = await db
      .from("scores")
      .select("team_id")
      .eq("chapter_id", chapterId);
    expect(preScores ?? [], "no scores finalized yet").toHaveLength(0);

    await adminLoginViaSession(page);
    await page.goto(`/admin/chapters/${chapterId}/scores`);

    // The page must show the truthful "unfinalized" warning (the #39 fix), naming
    // the count of teams whose displayed jury results are not yet finalized, and
    // must NOT show the false "NO scores yet" empty-state warning.
    await expect(
      page.getByText(/have not been finalized into scores/i)
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/will NOT\s+appear on the public leaderboard/i)).toBeVisible();
    // The false empty-state warning ("This chapter has NO scores yet") must NOT
    // show. Match the distinctive "no scores yet" fragment (case-insensitive) so
    // this catches the empty warning regardless of exact surrounding wording.
    await expect(page.getByText(/no scores yet/i)).toHaveCount(0);
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

  test("the emailed certificate link is viewable WITHOUT login via the capability token (#36)", async ({ baseURL }) => {
    // Regression for #36: a participant clicks the certificate link from their
    // email while NOT logged in. The PDF route authorizes via a stateless HMAC
    // capability token bound to (chapterId, teamId) — no session, no enumeration.
    // We sign a REAL token with the same secret the app uses, fetch it from a
    // fresh LOGGED-OUT request context, and assert the full token contract.
    const db = adminClient();
    const { data: team } = await db
      .from("teams")
      .select("id")
      .eq("name", TEAM_NAME)
      .single();
    const teamId = team!.id as string;

    // Precondition: this team's score is published (set by the publish step above);
    // the route only serves a certificate for a published score.
    const { data: score } = await db
      .from("scores")
      .select("published")
      .eq("chapter_id", chapterId)
      .eq("team_id", teamId)
      .single();
    expect(score?.published, "score is published").toBe(true);

    const goodToken = certificateToken(chapterId, teamId);
    const base = `/api/certificates/${chapterId}/${teamId}`;

    // A brand-new request context with NO cookies = a logged-out recipient.
    const anon = await playwrightRequest.newContext({ baseURL: baseURL ?? undefined });
    try {
      // 1) Valid token, logged out -> 200 and a real PDF.
      const ok = await anon.get(`${base}?token=${goodToken}`);
      expect(ok.status(), "valid token logged-out -> 200").toBe(200);
      expect(ok.headers()["content-type"]).toContain("application/pdf");
      const body = await ok.body();
      expect(body.subarray(0, 4).toString("latin1"), "real PDF bytes").toBe("%PDF");

      // 2) No token -> 401 (no PII leak without the capability).
      expect((await anon.get(base)).status(), "no token -> 401").toBe(401);

      // 3) Wrong token -> 401.
      expect(
        (await anon.get(`${base}?token=not-the-real-token`)).status(),
        "wrong token -> 401"
      ).toBe(401);

      // 4) A token valid for THIS chapter but a DIFFERENT team must not authorize
      //    this certificate (no cross-team enumeration).
      const otherTeamToken = certificateToken(chapterId, "00000000-0000-0000-0000-000000000000");
      expect(
        (await anon.get(`${base}?token=${otherTeamToken}`)).status(),
        "other-team token -> 401"
      ).toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
