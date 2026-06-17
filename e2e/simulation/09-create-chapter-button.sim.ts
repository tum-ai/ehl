/**
 * Regression for FINDINGS.md #1: the admin "New Chapter" button.
 *
 * createNewChapter() inserted a chapter without the NOT NULL `match_number`, so
 * clicking "New Chapter" failed in production with a not-null violation (an
 * alert() fired and navigation never happened). This drives the REAL button and
 * asserts it navigates to the new chapter editor — it FAILS before the fix and
 * PASSES after. The fix supplies match_number = max+1 before recalculation.
 */
import { test, expect } from "@playwright/test";
import { adminLoginViaSession, adminClient, cleanupSimData, clearMailbox } from "./sim-helpers";

test.describe("Simulation: admin New Chapter button (real UI, regression)", () => {
  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test('clicking "New Chapter" creates a chapter and opens its editor', async ({ page }) => {
    await adminLoginViaSession(page);
    await page.goto("/admin/chapters");

    // No dialog should appear; if the bug regressed, the action alerts instead
    // of navigating. Fail loudly with the alert text if it does.
    let dialogText: string | null = null;
    page.on("dialog", async (d) => {
      dialogText = d.message();
      await d.dismiss();
    });

    await page.getByRole("button", { name: /^new chapter$/i }).click();

    // Success path: router.push to /admin/chapters/<uuid>.
    await page.waitForURL(/\/admin\/chapters\/[0-9a-f-]{36}$/, { timeout: 20000 });
    expect(dialogText, `New Chapter must not error (alert was: ${dialogText})`).toBeNull();

    // The new chapter exists with a valid (non-null) match_number.
    const id = page.url().split("/").pop()!;
    const db = adminClient();
    const { data } = await db.from("chapters").select("id,match_number").eq("id", id).maybeSingle();
    expect(data, "new chapter row should exist").toBeTruthy();
    expect(typeof data!.match_number, "match_number must be set").toBe("number");

    // Cleanup this freshly-created chapter (name defaults to "New Chapter").
    await db.from("chapters").delete().eq("id", id);
  });
});
