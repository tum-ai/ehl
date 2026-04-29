import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Jury login page", () => {
  test("page loads with magic link form", async ({ page }) => {
    await page.goto("/jury/login");

    // Should display the EHL logo and Jury Portal label
    await expect(page.getByAltText("EHL")).toBeVisible();
    await expect(page.getByText("Jury Portal")).toBeVisible();
  });

  test("email input and submit button are present", async ({ page }) => {
    await page.goto("/jury/login");

    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute("type", "email");
    await expect(emailInput).toHaveAttribute("required", "");

    const submitButton = page.getByRole("button", {
      name: /send magic link/i,
    });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });

  test("invitation notice is displayed", async ({ page }) => {
    await page.goto("/jury/login");

    await expect(
      page.getByText("You need a jury invitation to access this portal.")
    ).toBeVisible();
  });

  test("submitting a valid email shows success screen", async ({ page }) => {
    await page.goto("/jury/login");

    // Fill in the email of a seeded jury member
    await page.locator('input[name="email"]').fill(SEED.jury[0].email);
    await page.getByRole("button", { name: /send magic link/i }).click();

    // After submission, the success screen should appear
    await expect(page.getByText("Check your email")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText("We sent a magic link to your email.")
    ).toBeVisible();
  });

  test("empty email submission triggers browser validation", async ({
    page,
  }) => {
    await page.goto("/jury/login");

    // Click submit without filling email
    await page.getByRole("button", { name: /send magic link/i }).click();

    // Should stay on the login page due to required field validation
    await expect(page).toHaveURL(/\/jury\/login/);
  });
});

test.describe("Jury dashboard (unauthenticated)", () => {
  test("redirects to jury login when not authenticated", async ({ page }) => {
    await page.goto("/jury");

    // Server-side redirect should send unauthenticated users to the login page
    await expect(page).toHaveURL(/\/jury\/login/, { timeout: 10000 });
  });
});

test.describe("Jury chapter detail (unauthenticated)", () => {
  test("redirects to jury login when accessing chapter page", async ({
    page,
  }) => {
    await page.goto(`/jury/${SEED.chapters.munich.slug}`);

    await expect(page).toHaveURL(/\/jury\/login/, { timeout: 10000 });
  });
});

test.describe("Jury ranking page structure", () => {
  test("redirects to jury login when accessing ranking page unauthenticated", async ({
    page,
  }) => {
    await page.goto(`/jury/${SEED.chapters.munich.slug}/rank`);

    // The ranking page requires authentication, so it should redirect
    await expect(page).toHaveURL(/\/jury\/login/, { timeout: 10000 });
  });

  test("ranking page uses correct URL pattern with chapter slug", async ({
    page,
  }) => {
    // Verify the URL pattern is well-formed by navigating to it
    // Even without auth, the page should exist (redirect is the expected behavior)
    const response = await page.goto(
      `/jury/${SEED.chapters.munich.slug}/rank`
    );

    // Should get a response (not a 404), even if it redirects
    expect(response).not.toBeNull();
    expect(response!.status()).not.toBe(404);
  });
});
