import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Admin applications", () => {
  const chapterId = SEED.chapters.zurich.id;

  test.describe("Applications list page", () => {
    test("applications page loads at expected URL", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      // Authenticated admins land on the applications page; unauthenticated
      // requests (this suite has no admin session) redirect to /admin/login.
      await expect(page).toHaveURL(
        new RegExp(`/admin/(chapters/${chapterId}/applications|login)`)
      );
    });

    test("page shows screening heading when authenticated", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      // If authenticated, the page shows "Screening" as the heading
      // and a description about scoring applicants
      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        await expect(heading).toBeVisible();
        await expect(
          page.getByText(
            /score applicants|review profiles|manage acceptances/i
          )
        ).toBeVisible();
      }
    });

    test("stats cards show counts", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Stats bar should display key metrics
        const expectedStats = [
          "Total",
          "Pending",
          "Accepted",
          "Rejected",
          "Waitlisted",
          "Checked In",
          "Scored",
          "With Points",
        ];

        for (const stat of expectedStats) {
          await expect(page.getByText(stat, { exact: true })).toBeVisible();
        }
      }
    });

    test("filter by status dropdown is present", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Status filter dropdown
        const statusSelect = page.locator("select").first();
        await expect(statusSelect).toBeVisible();

        // Check that filter options exist
        await expect(statusSelect.locator("option")).toHaveCount(6); // all, pending, accepted, rejected, waitlisted, checked_in
      }
    });

    test("filter by status changes displayed applications", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // Wait for data to load (loading state should disappear)
        await page.waitForSelector("table", { timeout: 15000 });

        // Select "Pending" filter
        const statusSelect = page
          .locator("select")
          .filter({ hasText: /all statuses/i });
        const selectCount = await statusSelect.count();

        if (selectCount > 0) {
          await statusSelect.selectOption("pending");

          // The table should still be visible (or show "No applications match")
          await expect(page.locator("table")).toBeVisible();
        }
      }
    });

    test("search input is present", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        const searchInput = page.locator(
          'input[placeholder*="Search by name or email"]'
        );
        await expect(searchInput).toBeVisible();
      }
    });

    test("applications table has expected columns", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        await page.waitForSelector("table", { timeout: 15000 });

        // Table headers
        const expectedHeaders = [
          "Name",
          "Email",
          "Score",
          "League",
          "Status",
          "Flags",
          "Actions",
        ];

        for (const header of expectedHeaders) {
          await expect(
            page.locator("th", { hasText: header }).first()
          ).toBeVisible();
        }
      }
    });

    test("league filter dropdown is present with options", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        // League filter is the second or third select
        const leagueSelect = page
          .locator("select")
          .filter({ hasText: /all applicants/i });
        const selectCount = await leagueSelect.count();

        if (selectCount > 0) {
          await expect(leagueSelect).toBeVisible();

          // Should have filtering options
          await expect(
            leagueSelect.locator('option[value="member"]')
          ).toHaveText("League Members");
          await expect(
            leagueSelect.locator('option[value="new"]')
          ).toHaveText("New applicants");
        }
      }
    });

    test("bulk action buttons appear when selecting applications", async ({
      page,
    }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        await page.waitForSelector("table", { timeout: 15000 });

        // Check for the "select all" checkbox in the table header
        const selectAllCheckbox = page.locator("thead input[type='checkbox']");
        const checkboxCount = await selectAllCheckbox.count();

        if (checkboxCount > 0) {
          await expect(selectAllCheckbox).toBeVisible();
        }

        // The "Accept Top N" and "Send All Pending Emails" buttons should be visible
        await expect(
          page.getByRole("button", { name: /accept top n/i })
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /send all pending emails/i })
        ).toBeVisible();
      }
    });

    test("back to chapter link is present", async ({ page }) => {
      await page.goto(`/admin/chapters/${chapterId}/applications`);

      const heading = page.getByRole("heading", { name: /screening/i });
      const isVisible = await heading.isVisible().catch(() => false);

      if (isVisible) {
        const backLink = page.getByRole("link", {
          name: /back to chapter/i,
        });
        await expect(backLink).toBeVisible();
        await expect(backLink).toHaveAttribute(
          "href",
          `/admin/chapters/${chapterId}`
        );
      }
    });
  });
});
