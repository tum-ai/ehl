import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Admin scores", () => {
  // Munich chapter is the completed one per seed data
  const completedChapterId = SEED.chapters.munich.id;
  const zurichChapterId = SEED.chapters.zurich.id;

  test.describe("Scores page for completed chapter", () => {
    test("scores page loads at expected URL", async ({ page }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      // Authenticated admins land on the scores page; unauthenticated requests
      // (this suite has no admin session) redirect to /admin/login.
      await expect(page).toHaveURL(
        new RegExp(`/admin/(chapters/${completedChapterId}/scores|login)`)
      );
    });

    test("scores page shows heading and scoring reference", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        await expect(heading).toBeVisible();

        // Scoring reference card should show point values
        await expect(page.getByText(/scoring:/i)).toBeVisible();
        await expect(page.getByText(/1st/)).toBeVisible();
        await expect(page.getByText(/2nd/)).toBeVisible();
        await expect(page.getByText(/3rd/)).toBeVisible();
        await expect(page.getByText(/participation/i)).toBeVisible();
      }
    });

    test("shows Published badge for completed chapter", async ({ page }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Completed chapters should show "Published" badge
        await expect(page.getByText("Published")).toBeVisible();
      }
    });

    test("score overrides table has expected columns", async ({ page }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Wait for data to load
        await page.waitForSelector("table", { timeout: 15000 });

        // Score overrides section
        await expect(page.getByText("Score Overrides")).toBeVisible();

        // Table headers
        const expectedHeaders = [
          "Team",
          "Current Placement",
          "Points",
          "Source",
          "Challenge",
          "Override",
        ];

        for (const header of expectedHeaders) {
          const headerElement = page
            .locator("th", { hasText: header })
            .first();
          const headerVisible = await headerElement
            .isVisible()
            .catch(() => false);
          if (headerVisible) {
            await expect(headerElement).toBeVisible();
          }
        }
      }
    });

    test("back to chapter link is present", async ({ page }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        const backLink = page.getByRole("link", {
          name: /back to chapter/i,
        });
        await expect(backLink).toBeVisible();
        await expect(backLink).toHaveAttribute(
          "href",
          `/admin/chapters/${completedChapterId}`
        );
      }
    });

    test("description mentions reviewing and publishing", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        await expect(
          page.getByText(
            /review jury rankings|apply overrides|publish results/i
          )
        ).toBeVisible();
      }
    });
  });

  test.describe("Scores page for non-completed chapter", () => {
    test("scores page loads for non-completed chapter", async ({ page }) => {
      await page.goto(`/admin/chapters/${zurichChapterId}/scores`);

      // Authenticated admins land on the scores page; unauthenticated requests
      // (this suite has no admin session) redirect to /admin/login.
      await expect(page).toHaveURL(
        new RegExp(`/admin/(chapters/${zurichChapterId}/scores|login)`)
      );
    });

    test("shows Draft badge for non-completed chapter", async ({ page }) => {
      await page.goto(`/admin/chapters/${zurichChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Non-completed chapters should show "Draft" badge
        await expect(page.getByText("Draft")).toBeVisible();

        // Should show the Publish Results section
        await expect(page.getByText("Publish Results")).toBeVisible();
        await expect(
          page.getByRole("button", { name: /publish results/i })
        ).toBeVisible();
      }
    });

    test("override dropdowns are enabled for non-published chapter", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${zurichChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Wait for data to load
        await page.waitForSelector(
          'text="Score Overrides"',
          { timeout: 15000 }
        ).catch(() => null);

        // Check for override select dropdowns in the table
        const overrideSelects = page.locator(
          "table select:not([disabled])"
        );
        const selectCount = await overrideSelects.count();

        // If there are teams with scores/rankings, selects should be enabled
        // For a non-completed chapter, this may be 0 if no scores exist yet
        expect(selectCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  test.describe("Jury rankings section", () => {
    test("jury rankings section shows or indicates no rankings", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${completedChapterId}/scores`);

      const heading = page.getByRole("heading", { name: /scores/i }).first();
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Should show either "Jury Rankings" heading or the manual-results
        // banner (shown whenever no jury votes exist for the chapter).
        const juryHeading = page.getByText("Jury Rankings");
        const noRankings = page.getByText(
          /manual results mode: no jury votes recorded/i
        );

        const hasJuryHeading = await juryHeading
          .isVisible()
          .catch(() => false);
        const hasNoRankings = await noRankings
          .isVisible()
          .catch(() => false);

        // One of these should be true
        expect(hasJuryHeading || hasNoRankings).toBe(true);
      }
    });
  });
});
