/**
 * Simulation slice 6: real-UI jury assignment + ranking.
 *
 * Admin sets up a chapter + challenge through the real admin UI and assigns a
 * jury member to the challenge via the real admin jury UI (which emails a magic
 * link). The jury member logs in through the real /jury/login flow (magic link
 * captured from Mailpit), opens the real ranking UI, ranks the submitted team,
 * and submits the vote. We assert a jury_rankings row exists.
 *
 * The submitted team + submission are bootstrapped via the admin client (their
 * own UI is covered by slice 5); this slice's subject is the jury flow.
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

const CHAPTER_NAME = "Sim Jury Match";
const CHALLENGE_TITLE = "Sim Jury Challenge";
const TEAM_PRESIDENT = simEmail("sim-jury-pres");
const JURY_EMAIL = simEmail("sim-jury-1");
const TEAM_NAME = "Sim Pitchers";

test.describe("Simulation: jury assignment + ranking (real UI)", () => {
  let chapterId: string;
  let slug: string;
  let challengeId: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin sets up a submitted team and assigns a jury member via the real UI", async ({ page, browser }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    chapterId = created.id;
    await createChallengeViaUI(page, chapterId, { title: CHALLENGE_TITLE });
    challengeId = await getChallengeId(chapterId, CHALLENGE_TITLE);

    const db = adminClient();
    const { data: chapter } = await db.from("chapters").select("slug").eq("id", chapterId).single();
    slug = chapter!.slug as string;

    // A real registered participant to own the submitted team.
    const presCtx = await browser.newContext();
    await registerSoloViaUI(await presCtx.newPage(), { name: "Sim Jury Pres", email: TEAM_PRESIDENT });
    await presCtx.close();
    const { data: pres } = await db.from("profiles").select("id").eq("email", TEAM_PRESIDENT).single();

    // Bootstrap the registered team + a submission (precondition for ranking).
    await bootstrapSubmission({
      chapterId,
      challengeId,
      teamName: TEAM_NAME,
      presidentUserId: pres!.id as string,
      projectName: "Sim Jury Project",
    });

    // Advance to pitching so the jury can rank (needs submission + jury).
    // First assign the jury (also satisfies the pitching readiness check).
    await assignJuryViaUI(page, {
      chapterId,
      challengeId,
      juryName: "Sim Jury One",
      juryEmail: JURY_EMAIL,
    });
    await advanceChapterStatusViaUI(page, chapterId, "pitching");

    const { data: assignment } = await db
      .from("jury_assignments")
      .select("status")
      .eq("challenge_id", challengeId)
      .maybeSingle();
    expect(assignment, "jury assignment should exist").toBeTruthy();
  });

  test("jury logs in via the real /jury/login and submits a ranking", async ({ page }) => {
    await juryLoginViaUI(page, JURY_EMAIL);

    // Submit a ranking through the real jury ranking UI (one eligible team).
    await submitSingleTeamRankingViaUI(page, { slug, teamName: TEAM_NAME });

    // DB: a jury_rankings row exists for this challenge.
    const db = adminClient();
    const { data: jury } = await db.from("profiles").select("id").eq("email", JURY_EMAIL).single();
    await expect
      .poll(async () => {
        const { count } = await db
          .from("jury_rankings")
          .select("id", { count: "exact", head: true })
          .eq("challenge_id", challengeId)
          .eq("entered_by", jury!.id);
        return count ?? 0;
      }, { timeout: 15000 })
      .toBe(1);
  });

  test("a juror on TWO challenges sees the challenge picked by ?challenge=, not the first (#35)", async ({ page, browser }) => {
    test.setTimeout(120_000);
    // Regression for #35: a juror assigned to two challenges in the SAME chapter
    // used to always see the FIRST challenge's submissions (every layer resolved
    // the assignment by chapter alone). The fix resolves by the ?challenge= id.
    // We add a SECOND challenge with its OWN submitted team, assign the SAME juror,
    // then open the rank UI for the second challenge and assert it shows the SECOND
    // team — and NOT the first challenge's team.
    const db = adminClient();
    const SECOND_CHALLENGE = "Sim Jury Challenge Two";
    const SECOND_TEAM = "Sim Pitchers Two";
    const SECOND_PRES = simEmail("sim-jury-pres-2");

    await adminLoginViaSession(page);
    await createChallengeViaUI(page, chapterId, { title: SECOND_CHALLENGE });
    const challengeId2 = await getChallengeId(chapterId, SECOND_CHALLENGE);

    const presCtx = await browser.newContext();
    await registerSoloViaUI(await presCtx.newPage(), { name: "Sim Jury Pres Two", email: SECOND_PRES });
    await presCtx.close();
    const { data: pres2 } = await db.from("profiles").select("id").eq("email", SECOND_PRES).single();

    await bootstrapSubmission({
      chapterId,
      challengeId: challengeId2,
      teamName: SECOND_TEAM,
      presidentUserId: pres2!.id as string,
      projectName: "Sim Jury Project Two",
    });

    // Assign the SAME juror (JURY_EMAIL) to the second challenge too.
    await assignJuryViaUI(page, {
      chapterId,
      challengeId: challengeId2,
      juryName: "Sim Jury One",
      juryEmail: JURY_EMAIL,
    });
    // Confirm the juror now has TWO assignments in this chapter (the #35 condition).
    const { data: jury } = await db.from("profiles").select("id").eq("email", JURY_EMAIL).single();
    await expect
      .poll(async () => {
        const { count } = await db
          .from("jury_assignments")
          .select("user_id", { count: "exact", head: true })
          .eq("user_id", jury!.id)
          .in("challenge_id", [challengeId, challengeId2]);
        return count ?? 0;
      }, { timeout: 15000 })
      .toBe(2);

    // Log in as the juror and open the rank UI for the SECOND challenge explicitly.
    await juryLoginViaUI(page, JURY_EMAIL);
    await page.goto(`/jury/${slug}/rank?challenge=${challengeId2}`);

    // The available-teams list must show the SECOND challenge's team, and must NOT
    // show the FIRST challenge's team (the bug returned the first challenge here).
    await expect(
      page.getByRole("button", { name: new RegExp(SECOND_TEAM, "i") }).first()
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("button", { name: new RegExp(`^${TEAM_NAME}$`, "i") })
    ).toHaveCount(0);
  });
});
