import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";
import { createChapter, createParticipant, createTeam } from "../helpers/data-factory";
import { getAdminClient } from "../fixtures/supabase-admin";

/**
 * Grand Finale invite, end to end through the real page and the real database.
 *
 * Two things matter most here:
 *  - opening the link must record NOTHING. Mail scanners fetch every URL in an
 *    email before the recipient sees it, and here a write would not just log a
 *    fabricated answer: it would ACCEPT people and mail them a check-in QR.
 *  - clicking "I'm in" must produce a real accepted application with a check-in
 *    token, because that row (not the invite) is what check-in scans.
 *
 * The admin send button is covered by tests/finale-invite-send.test.ts; this
 * seeds the invite row the same way the button does, straight from the column
 * default.
 */
test.describe("Grand Finale invite page", () => {
  const stamp = Date.now();
  const email = `finale-e2e-${stamp}@example.com`;

  let chapterId: string;
  let teamId: string;
  let userId: string;
  let token: string;

  test.beforeAll(async () => {
    const admin = getAdminClient();

    const chapter = await createChapter({
      name: `Grand Finale E2E ${stamp}`,
      city: "Munich",
      country: "Germany",
      description: "Finale invite e2e",
      date: "2026-10-10",
      dateEnd: "2026-10-11",
    });
    chapterId = chapter.id;

    await admin
      .from("chapters")
      .update({ is_finale: true, status: "applications_open" })
      .eq("id", chapterId);

    userId = await createParticipant({ email, name: "Finale Tester" });
    teamId = await createTeam({ name: `Finale Team ${stamp}`, presidentUserId: userId });

    const { data, error } = await admin
      .from("finale_invites")
      .insert({ chapter_id: chapterId, team_id: teamId, user_id: userId, email })
      .select("invite_token")
      .single();

    if (error) throw new Error(`Failed to seed finale invite: ${error.message}`);
    token = data.invite_token as string;
  });

  test.afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("finale_invites").delete().eq("chapter_id", chapterId);
    await admin.from("applications").delete().eq("chapter_id", chapterId);
    await admin.from("team_members").delete().eq("team_id", teamId);
    await admin.from("teams").delete().eq("id", teamId);
    await admin.from("chapters").delete().eq("id", chapterId);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  });

  async function storedInvite() {
    const { data } = await getAdminClient()
      .from("finale_invites")
      .select("response, application_id")
      .eq("invite_token", token)
      .single();
    return data as { response: string | null; application_id: string | null } | null;
  }

  async function storedApplication() {
    const { data } = await getAdminClient()
      .from("applications")
      .select("id, status, check_in_token, existing_team_id")
      .eq("chapter_id", chapterId)
      .eq("email", email)
      .maybeSingle();
    return data as
      | { id: string; status: string; check_in_token: string; existing_team_id: string | null }
      | null;
  }

  test("an unknown token 404s instead of revealing anything", async ({ page }) => {
    const response = await page.goto("/finale/00000000-0000-0000-0000-0000000000ff");
    expect(response?.status()).toBe(404);
  });

  test("opening the link repeatedly records NOTHING (mail scanner guard)", async ({ page }) => {
    // Three fetches stand in for a scanner prefetch, a preview, and the
    // invitee's own open.
    for (let i = 0; i < 3; i++) {
      await page.goto(`/finale/${token}`);
      await expect(page.getByRole("heading", { name: /grand finale/i })).toBeVisible();
    }

    expect((await storedInvite())?.response).toBeNull();
    expect(await storedApplication()).toBeNull();
  });

  test("shows both choices before an answer exists", async ({ page }) => {
    await page.goto(`/finale/${token}`);

    await expect(page.getByRole("button", { name: /i'm in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /i'm out/i })).toBeVisible();
  });

  test("clicking I'm in accepts the person, and the answer is then locked", async ({ page }) => {
    await page.goto(`/finale/${token}`);
    await page.getByRole("button", { name: /i'm in/i }).click();

    await expect(page.getByText(/your spot is confirmed/i)).toBeVisible();

    const application = await storedApplication();
    expect(application?.status).toBe("accepted");
    // The QR the acceptance email carries, and what check-in scans.
    expect(application?.check_in_token).toBeTruthy();
    expect(application?.existing_team_id).toBe(teamId);

    const invite = await storedInvite();
    expect(invite?.response).toBe("yes");
    expect(invite?.application_id).toBe(application?.id);

    // The buttons are gone: the first answer is final.
    await expect(page.getByRole("button", { name: /i'm in/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /i'm out/i })).toHaveCount(0);

    // And it survives a reload, still with no way to change it.
    await page.reload();
    await expect(page.getByText(/your spot is confirmed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /i'm out/i })).toHaveCount(0);
    expect((await storedInvite())?.response).toBe("yes");
  });

  test("the admin board is closed to participants", async ({ page }) => {
    // Global-admin-only page: the qualifying teams come from the season
    // leaderboard, not from this chapter's applicants.
    const response = await page.goto(`/admin/chapters/${SEED.chapters.zurich.id}/finale-invites`);
    expect(response?.url()).toContain("/admin/login");
  });
});
