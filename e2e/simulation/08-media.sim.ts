/**
 * Simulation slice 8: real-UI admin media (photo) upload.
 *
 * Admin creates a chapter through the real admin UI, opens the real photos
 * page, and uploads a small generated PNG through the real file input. We assert
 * a media row is persisted for the chapter.
 *
 * Note: the photos page uploads to Google Drive (the "uploads" bucket is not a
 * Supabase Storage bucket). If the test environment has working Drive
 * credentials this passes end to end; if not, the upload fails at the Drive
 * boundary (documented in README / FINDINGS).
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  tinyPngBuffer,
  adminClient,
  clearMailbox,
  cleanupSimData,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Media Match";

test.describe("Simulation: media upload (real UI)", () => {
  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin uploads a photo via the real media UI", async ({ page }) => {
    await adminLoginViaSession(page);
    const { id: chapterId } = await createChapterViaUI(page, { name: CHAPTER_NAME });

    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/chapters/${chapterId}/photos`);

    // The page has a hidden-ish file input (type=file, accept=image/*, multiple).
    await page.locator('input[type="file"]').setInputFiles({
      name: "sim-photo.png",
      mimeType: "image/png",
      buffer: tinyPngBuffer(),
    });

    // A media row should be created for this chapter once the upload completes.
    const db = adminClient();
    await expect
      .poll(async () => {
        const { data } = await db.from("media").select("id").eq("chapter_id", chapterId);
        return (data ?? []).length;
      }, { timeout: 60000, intervals: [2000] })
      .toBeGreaterThan(0);

    // The uploaded photo renders in the admin grid (alt="Match photo").
    await expect(page.locator('img[alt="Match photo"]').first()).toBeVisible({ timeout: 20000 });
  });
});
