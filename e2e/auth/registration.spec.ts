import { test, expect, type Page } from "@playwright/test";

// The register page is a mode picker ("Join the EHL" → Register Solo /
// Create a Team). The team form only appears after choosing "Create a Team".
async function openTeamForm(page: Page) {
  await page.goto("/register");
  await page.getByRole("heading", { name: "Create a Team" }).click();
  await expect(page.locator('input[name="teamName"]')).toBeVisible();
}

test.describe("Registration page", () => {
  test("mode picker offers solo and team registration", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByText("Join the EHL")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Register Solo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a Team" })).toBeVisible();
  });

  test("team form shows its core fields after choosing Create a Team", async ({ page }) => {
    await openTeamForm(page);

    await expect(page.locator('input[name="teamName"]')).toBeVisible();
    await expect(page.locator('input[name="presidentName"]')).toBeVisible();
    await expect(page.locator('input[name="presidentEmail"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible();
  });

  test("validation: password too short", async ({ page }) => {
    await openTeamForm(page);

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

    // Server-side validation should return an error about password length.
    // Scope to the error banner, not the required-field asterisks (also .text-error).
    await expect(page.locator("div.bg-error\\/5")).toBeVisible({ timeout: 10000 });
  });

  test("member counter starts at 1 and can go down to 0", async ({ page }) => {
    await openTeamForm(page);

    // The team form starts with 1 additional member field and the counter at 1.
    await expect(page.locator(".font-mono.text-gold")).toHaveText("1");
    await expect(page.locator('input[name="memberName0"]')).toBeVisible();
    await expect(page.locator('input[name="memberEmail0"]')).toBeVisible();

    // "-" is enabled at 1 (a president may register with no extra members);
    // it becomes disabled only at 0.
    const minusButton = page.locator("button", { hasText: "-" });
    await expect(minusButton).toBeEnabled();
    await minusButton.click();
    await expect(page.locator(".font-mono.text-gold")).toHaveText("0");
    await expect(minusButton).toBeDisabled();
    await expect(page.locator('input[name="memberName0"]')).not.toBeVisible();
  });

  test("can add member fields", async ({ page }) => {
    await openTeamForm(page);

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
    await openTeamForm(page);

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
    await openTeamForm(page);

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
