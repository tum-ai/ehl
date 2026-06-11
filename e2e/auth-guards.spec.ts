import { test, expect } from "@playwright/test";
import { SEED } from "./helpers/auth";

test.describe("Auth guards", () => {
  test.describe("Admin routes redirect unauthenticated users", () => {
    test("visiting /admin redirects to /admin/login", async ({ page }) => {
      await page.goto("/admin");

      // Middleware redirects unauthenticated users to the admin login page.
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(
        page.getByText(/admin login/i).first()
      ).toBeVisible({ timeout: 10000 });
    });

    test("visiting /admin/chapters redirects to /admin/login when unauthenticated", async ({
      page,
    }) => {
      await page.goto("/admin/chapters");
      // Middleware must redirect an unauthenticated user to the login page,
      // not merely leave them somewhere under /admin.
      await expect(page).toHaveURL(/\/admin\/login/);
    });
  });

  test.describe("Jury routes redirect unauthenticated users", () => {
    test("visiting /jury redirects to /jury/login", async ({ page }) => {
      await page.goto("/jury");
      // Must actually land on the jury login page (a non-redirect would be a
      // guard failure, which the old |\/jury alternative silently allowed).
      await expect(page).toHaveURL(/\/jury\/login/);
    });

    test("visiting /jury/rankings redirects to /jury/login when unauthenticated", async ({ page }) => {
      await page.goto("/jury/rankings");
      await expect(page).toHaveURL(/\/jury\/login/);
    });
  });

  test.describe("Participant routes redirect unauthenticated users", () => {
    test("visiting /dashboard redirects to /login when unauthenticated", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/login/);
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
