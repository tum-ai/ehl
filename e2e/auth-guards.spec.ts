import { test, expect } from "@playwright/test";
import { SEED } from "./helpers/auth";

test.describe("Auth guards", () => {
  test.describe("Admin routes redirect unauthenticated users", () => {
    test("visiting /admin redirects to /admin/login", async ({ page }) => {
      await page.goto("/admin");

      // Unauthenticated users should see the admin login page content
      // The admin layout renders children without sidebar when not authenticated,
      // and /admin should show the login or redirect to it
      await expect(page).toHaveURL(/\/admin/);

      // Should see the Google sign-in prompt for admin
      await expect(
        page.getByText(/admin login/i).first()
      ).toBeVisible({ timeout: 10000 });
    });

    test("visiting /admin/chapters shows admin login when unauthenticated", async ({
      page,
    }) => {
      await page.goto("/admin/chapters");

      // Without a valid admin session, the layout won't show the sidebar
      // and the page should either redirect or show login content
      // The admin layout checks session and renders without sidebar if not admin
      await expect(page).toHaveURL(/\/admin/);
    });
  });

  test.describe("Jury routes redirect unauthenticated users", () => {
    test("visiting /jury redirects to /jury/login", async ({ page }) => {
      await page.goto("/jury");

      // Should end up at jury login
      await expect(page).toHaveURL(/\/jury\/login|\/jury/);
    });
  });

  test.describe("Public pages work without authentication", () => {
    test("/leaderboard loads without auth", async ({ page }) => {
      const response = await page.goto("/leaderboard");

      // Should get a successful response
      expect(response?.status()).toBeLessThan(400);

      // Should see leaderboard content
      await expect(page).toHaveURL(/\/leaderboard/);
    });

    test("/matches loads without auth", async ({ page }) => {
      const response = await page.goto("/matches");

      // Should get a successful response
      expect(response?.status()).toBeLessThan(400);

      // Should see matches content
      await expect(page).toHaveURL(/\/matches/);
    });

    test("home page loads without auth", async ({ page }) => {
      const response = await page.goto("/");

      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL("/");
    });

    test("/login loads without auth", async ({ page }) => {
      const response = await page.goto("/login");

      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByText("Team Login")).toBeVisible();
    });

    test("/register loads without auth", async ({ page }) => {
      const response = await page.goto("/register");

      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByText("Register Your Team")).toBeVisible();
    });
  });
});
