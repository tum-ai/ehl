import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Registration page", () => {
  test("page loads with registration form", async ({ page }) => {
    await page.goto("/register");

    // Main heading
    await expect(page.getByText("Register Your Team")).toBeVisible();

    // Section headings
    await expect(page.getByText("Team Information")).toBeVisible();
    await expect(page.getByText("Team President")).toBeVisible();
    await expect(page.getByText("Team Members")).toBeVisible();

    // Core fields should be visible
    await expect(page.locator('input[name="teamName"]')).toBeVisible();
    await expect(page.locator('input[name="presidentName"]')).toBeVisible();
    await expect(page.locator('input[name="presidentEmail"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    // Continue button
    await expect(
      page.getByRole("button", { name: /continue/i })
    ).toBeVisible();
  });

  test("validation: password too short (min 6 characters)", async ({
    page,
  }) => {
    await page.goto("/register");

    // Fill all required fields with valid data except password
    await page.locator('input[name="teamName"]').fill("Test Team");
    await page.locator('input[name="presidentName"]').fill("Test President");
    await page
      .locator('input[name="presidentEmail"]')
      .fill("test@example.com");
    await page.locator('input[name="password"]').fill("abc"); // Too short

    // Fill the default member (member 0 is always present)
    await page.locator('input[name="memberName0"]').fill("Member One");
    await page
      .locator('input[name="memberEmail0"]')
      .fill("member1@example.com");

    // Submit the form
    await page.getByRole("button", { name: /continue/i }).click();

    // Server-side validation should return an error about password length
    const errorMessage = page.locator(".text-error");
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });

  test("validation: team needs at least 2 members total (president + 1 member)", async ({
    page,
  }) => {
    await page.goto("/register");

    // The form always starts with 1 member field (so president + 1 member = 2 total).
    // The minimum member count is 1, meaning you cannot go below 1 additional member.
    // The "-" button should be disabled when memberCount is 1.
    const minusButton = page.locator("button", { hasText: "-" });
    await expect(minusButton).toBeDisabled();

    // Member 0 fields should be visible (enforcing at least 1 additional member)
    await expect(page.locator('input[name="memberName0"]')).toBeVisible();
    await expect(page.locator('input[name="memberEmail0"]')).toBeVisible();
  });

  test("can add member fields", async ({ page }) => {
    await page.goto("/register");

    // Initially 1 member
    await expect(page.locator('input[name="memberName0"]')).toBeVisible();
    await expect(page.locator('input[name="memberName1"]')).not.toBeVisible();

    // Click "+" to add a member
    const plusButton = page.locator("button", { hasText: "+" });
    await plusButton.click();

    // Now member 1 fields should appear
    await expect(page.locator('input[name="memberName1"]')).toBeVisible();
    await expect(page.locator('input[name="memberEmail1"]')).toBeVisible();

    // The counter should show "2"
    await expect(page.locator(".font-mono.text-gold")).toHaveText("2");
  });

  test("can remove member fields", async ({ page }) => {
    await page.goto("/register");

    // Add two more members first (start with 1, add to get to 3)
    const plusButton = page.locator("button", { hasText: "+" });
    await plusButton.click();
    await plusButton.click();

    // Should now have 3 member fields
    await expect(page.locator('input[name="memberName2"]')).toBeVisible();

    // Remove one
    const minusButton = page.locator("button", { hasText: "-" });
    await minusButton.click();

    // Member 2 should be gone
    await expect(page.locator('input[name="memberName2"]')).not.toBeVisible();

    // Counter should show "2"
    await expect(page.locator(".font-mono.text-gold")).toHaveText("2");
  });

  test("cannot add more than 4 additional members", async ({ page }) => {
    await page.goto("/register");

    const plusButton = page.locator("button", { hasText: "+" });

    // Add up to max (4 additional members)
    await plusButton.click(); // 2
    await plusButton.click(); // 3
    await plusButton.click(); // 4

    // "+" button should now be disabled
    await expect(plusButton).toBeDisabled();

    // Counter should show "4"
    await expect(page.locator(".font-mono.text-gold")).toHaveText("4");

    // All 4 member fields should be visible
    await expect(page.locator('input[name="memberName3"]')).toBeVisible();
  });

  test("sign in link is present for existing teams", async ({ page }) => {
    await page.goto("/register");

    const signInLink = page.getByRole("link", { name: /sign in/i });
    await expect(signInLink).toBeVisible();
    await expect(signInLink).toHaveAttribute("href", "/login");
  });
});
