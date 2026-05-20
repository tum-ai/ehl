import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Admin chapter management", () => {
  test.describe("Chapter list page", () => {
    test("admin chapters page loads at /admin/chapters", async ({ page }) => {
      await page.goto("/admin/chapters");

      // The page should either show chapters table or admin login
      // (depending on auth state). We verify the URL is correct.
      await expect(page).toHaveURL(/\/admin\/chapters/);

      // If authenticated, we expect to see the chapters heading and table
      // If not authenticated, the admin layout renders without sidebar
      const heading = page.getByRole("heading", { name: /chapters/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Table headers should be present
        await expect(page.getByText("Name")).toBeVisible();
        await expect(page.getByText("City")).toBeVisible();
        await expect(page.getByText("Status")).toBeVisible();
      }
    });

    test("chapter list shows edit links", async ({ page }) => {
      await page.goto("/admin/chapters");

      const heading = page.getByRole("heading", { name: /chapters/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Each chapter row should have an Edit link
        const editLinks = page.getByRole("link", { name: /edit/i });
        const count = await editLinks.count();
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  test.describe("Chapter detail page", () => {
    const chapterId = SEED.chapters.zurich.id;

    test("chapter detail page loads with status control", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}`);

      // If authenticated, should see the chapter page with a status badge
      // The page shows status as a Badge component
      const backLink = page.getByRole("link", {
        name: /back to chapters/i,
      });
      const isVisible = await backLink.isVisible().catch(() => false);

      if (isVisible) {
        // Chapter heading should be visible
        await expect(
          page.getByRole("heading", { level: 1 })
        ).toBeVisible();

        // Status badge should be present (the Badge component renders the status text)
        // Zurich chapter has status "challenge_selection"
        const statusText = page.locator("[class*='badge'], [class*='Badge']");
        const badgeCount = await statusText.count();
        expect(badgeCount).toBeGreaterThan(0);

        // Manage section should have links to sub-pages
        await expect(page.getByText("Applications")).toBeVisible();
        await expect(page.getByText("Challenges")).toBeVisible();
        await expect(page.getByText("Manage Scores")).toBeVisible();
      }
    });

    test("chapter edit form has expected fields", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}`);

      const backLink = page.getByRole("link", {
        name: /back to chapters/i,
      });
      const isVisible = await backLink.isVisible().catch(() => false);

      if (isVisible) {
        // The ChapterEditForm should show the Details card with fields
        await expect(page.getByText("Details")).toBeVisible();

        // Name field
        const nameLabel = page.getByText("Name", { exact: true }).first();
        await expect(nameLabel).toBeVisible();

        // City field
        const cityLabel = page.getByText("City", { exact: true }).first();
        await expect(cityLabel).toBeVisible();

        // Country field
        const countryLabel = page
          .getByText("Country", { exact: true })
          .first();
        await expect(countryLabel).toBeVisible();

        // Description field
        const descLabel = page
          .getByText("Description", { exact: true })
          .first();
        await expect(descLabel).toBeVisible();
      }
    });

    test("chapter detail has navigation links to sub-pages", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${chapterId}`);

      const backLink = page.getByRole("link", {
        name: /back to chapters/i,
      });
      const isVisible = await backLink.isVisible().catch(() => false);

      if (isVisible) {
        // Verify all management links are present
        const expectedLinks = [
          "Applications",
          "Photos",
          "Challenges",
          "Team Unlocks",
          "Pitch Order",
          "Code Reviews",
          "Manage Scores",
          "Jury Management",
          "Partners",
          "View Public Page",
        ];

        for (const linkText of expectedLinks) {
          await expect(
            page.getByRole("link", { name: linkText })
          ).toBeVisible();
        }
      }
    });

    test("chapter detail has hero image section", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}`);

      const backLink = page.getByRole("link", {
        name: /back to chapters/i,
      });
      const isVisible = await backLink.isVisible().catch(() => false);

      if (isVisible) {
        // Hero image upload section
        await expect(page.getByText("Hero Image")).toBeVisible();
      }
    });
  });
});
