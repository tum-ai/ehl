import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";
import { createApplication } from "../helpers/data-factory";
import { getAdminClient } from "../fixtures/supabase-admin";

/**
 * Post-acceptance RSVP, end to end through the real page and the real database.
 *
 * The test that matters most is "opening the link records nothing": mail
 * scanners fetch every URL in an email before the recipient sees it, so if the
 * page wrote on GET the whole feature would report attendance nobody confirmed.
 */
test.describe("RSVP page", () => {
  const chapterId = SEED.chapters.zurich.id;
  const email = `rsvp-e2e-${Date.now()}@example.com`;

  let applicationId: string;
  let token: string;

  test.beforeAll(async () => {
    const admin = getAdminClient();

    applicationId = await createApplication({
      chapterId,
      email,
      firstName: "Rsvp",
      lastName: "Tester",
      status: "accepted",
    });

    // Ask them, the way the admin button does: a row exists only once someone
    // has been sent the request, and the token comes from the column default.
    const { data, error } = await admin
      .from("application_rsvps")
      .upsert({ application_id: applicationId }, { onConflict: "application_id" })
      .select("rsvp_token")
      .single();

    if (error) throw new Error(`Failed to seed RSVP row: ${error.message}`);
    token = data.rsvp_token as string;
  });

  test.afterAll(async () => {
    const admin = getAdminClient();
    // The RSVP row cascades with the application.
    await admin.from("applications").delete().eq("id", applicationId);
  });

  async function storedResponse(): Promise<string | null> {
    const { data } = await getAdminClient()
      .from("application_rsvps")
      .select("response")
      .eq("application_id", applicationId)
      .single();
    return (data?.response as string | null) ?? null;
  }

  test("an unknown token 404s instead of revealing anything", async ({ page }) => {
    const response = await page.goto("/rsvp/00000000-0000-0000-0000-0000000000ff");
    expect(response?.status()).toBe(404);
  });

  test("opening the link repeatedly records NOTHING (mail scanner guard)", async ({ page }) => {
    // Three fetches stand in for a scanner prefetch, a preview, and the
    // recipient's own open.
    for (let i = 0; i < 3; i++) {
      await page.goto(`/rsvp/${token}`);
      await expect(page.getByRole("heading", { name: /are you coming/i })).toBeVisible();
    }

    expect(await storedResponse()).toBeNull();
  });

  test("shows both choices before an answer exists", async ({ page }) => {
    await page.goto(`/rsvp/${token}`);

    await expect(page.getByRole("button", { name: /confirm attendance/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cannot make it/i })).toBeVisible();
  });

  test("clicking Confirm records the answer, and the answer is then locked", async ({ page }) => {
    await page.goto(`/rsvp/${token}`);
    await page.getByRole("button", { name: /confirm attendance/i }).click();

    await expect(page.getByText(/you confirmed your attendance/i)).toBeVisible();
    expect(await storedResponse()).toBe("yes");

    // The buttons are gone: the first answer is final.
    await expect(page.getByRole("button", { name: /confirm attendance/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cannot make it/i })).toHaveCount(0);

    // And it survives a reload, still with no way to change it.
    await page.reload();
    await expect(page.getByText(/you confirmed your attendance/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /cannot make it/i })).toHaveCount(0);
    expect(await storedResponse()).toBe("yes");
  });
});
