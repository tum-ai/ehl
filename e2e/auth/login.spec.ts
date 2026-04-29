import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Login page", () => {
  test("page loads with form fields and sign-in button", async ({ page }) => {
    await page.goto("/login");

    // Page should display the team login heading
    await expect(page.getByText("Team Login")).toBeVisible();

    // Email and password fields should be present
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    // Sign in button should be present
    await expect(
      page.getByRole("button", { name: /sign in/i })
    ).toBeVisible();
  });

  test("empty form submission shows browser validation (required fields)", async ({
    page,
  }) => {
    await page.goto("/login");

    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');

    // Both fields should have the required attribute
    await expect(emailInput).toHaveAttribute("required", "");
    await expect(passwordInput).toHaveAttribute("required", "");

    // Click sign in without filling anything - browser validation should prevent submission
    await page.getByRole("button", { name: /sign in/i }).click();

    // The form should not navigate away; we should still be on /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong credentials show an error message", async ({ page }) => {
    await page.goto("/login");

    await page.locator('input[name="email"]').fill("fake@nonexistent.com");
    await page.locator('input[name="password"]').fill("wrongpassword123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for the error message to appear
    const errorMessage = page.locator(".text-error");
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
    await expect(errorMessage).not.toBeEmpty();
  });

  test("forgot password link navigates to /forgot-password", async ({
    page,
  }) => {
    await page.goto("/login");

    const forgotLink = page.getByRole("link", { name: /forgot password/i });
    await expect(forgotLink).toBeVisible();
    await expect(forgotLink).toHaveAttribute("href", "/forgot-password");
  });

  test("jury login link is present and points to /jury/login", async ({
    page,
  }) => {
    await page.goto("/login");

    const juryLink = page.getByRole("link", { name: /jury login/i });
    await expect(juryLink).toBeVisible();
    await expect(juryLink).toHaveAttribute("href", "/jury/login");
  });

  test("register link is present for teams without accounts", async ({
    page,
  }) => {
    await page.goto("/login");

    const registerLink = page.getByRole("link", {
      name: /register your team/i,
    });
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute("href", "/register");
  });

  test("admin login link is present", async ({ page }) => {
    await page.goto("/login");

    const adminLink = page.getByRole("link", { name: /admin login/i });
    await expect(adminLink).toBeVisible();
    await expect(adminLink).toHaveAttribute("href", "/admin/login");
  });
});
