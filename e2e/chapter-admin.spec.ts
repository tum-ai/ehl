import { test, expect } from "@playwright/test";
import {
  createChapter,
  createChapterAdmin,
  generateMagicLink,
} from "./helpers/data-factory";

// Local (chapter) admins must be confined to their single chapter: they log in
// via the admin OAuth callback, land on their chapter, and are bounced from
// every other chapter and all global admin views. This spec seeds a chapter
// admin for chapter A and asserts that boundary end-to-end.
test.describe("Local (chapter) admin confinement", () => {
  const LOCAL_ADMIN = {
    email: "e2e-chapter-admin@test-ehl.com",
    name: "E2E Chapter Admin",
  };

  let chapterA: { id: string; slug: string };
  let chapterB: { id: string; slug: string };

  test.beforeAll(async () => {
    chapterA = await createChapter({
      name: "E2E Local Admin Chapter A",
      city: "Paris",
      country: "France",
      description: "Local admin scope chapter",
      date: "2026-09-01",
      dateEnd: "2026-09-02",
    });
    chapterB = await createChapter({
      name: "E2E Local Admin Chapter B",
      city: "Berlin",
      country: "Germany",
      description: "Out-of-scope chapter",
      date: "2026-10-01",
      dateEnd: "2026-10-02",
    });
    await createChapterAdmin({
      email: LOCAL_ADMIN.email,
      name: LOCAL_ADMIN.name,
      chapterId: chapterA.id,
    });
  });

  test.beforeEach(async ({ page }) => {
    // Log in through the real admin OAuth callback (next=/admin). Because the
    // email is not on the global allowlist, the callback resolves the
    // chapter_admins assignment and lands them on their chapter.
    const magicLink = await generateMagicLink(LOCAL_ADMIN.email, "/admin");
    await page.goto(magicLink);
    await page.waitForURL(/\/admin\/chapters\/[0-9a-f-]+/, { timeout: 15000 });
  });

  test("lands on their own chapter after login", async ({ page }) => {
    await expect(page).toHaveURL(new RegExp(`/admin/chapters/${chapterA.id}`));
    await expect(
      page.getByRole("heading", { name: "E2E Local Admin Chapter A" })
    ).toBeVisible();
  });

  test("sidebar shows the reduced, chapter-scoped nav", async ({ page }) => {
    await page.goto(`/admin/chapters/${chapterA.id}`);
    // Reduced nav present.
    await expect(page.getByRole("link", { name: "Screening" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check-in" })).toBeVisible();
    // Global-only nav items absent.
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admins" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("is bounced from the global dashboard to their chapter", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(new RegExp(`/admin/chapters/${chapterA.id}`));
  });

  test("is bounced from the global chapters list", async ({ page }) => {
    await page.goto("/admin/chapters");
    await expect(page).toHaveURL(new RegExp(`/admin/chapters/${chapterA.id}`));
  });

  test("cannot open the admin-management page", async ({ page }) => {
    await page.goto("/admin/admins");
    await expect(page).toHaveURL(new RegExp(`/admin/chapters/${chapterA.id}`));
  });

  test("cannot open another chapter", async ({ page }) => {
    await page.goto(`/admin/chapters/${chapterB.id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/chapters/${chapterA.id}`));
  });

  test("can open their chapter's screening page", async ({ page }) => {
    await page.goto(`/admin/chapters/${chapterA.id}/applications`);
    await expect(page).toHaveURL(
      new RegExp(`/admin/chapters/${chapterA.id}/applications`)
    );
  });
});
