import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Leaderboard page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/leaderboard");
  });

  test("page loads with heading and match count", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    await expect(page.getByText(/of 6 matches completed/)).toBeVisible();
  });

  test("shows all 6 teams in the table", async ({ page }) => {
    const table = page.locator("table");
    await expect(table).toBeVisible();

    for (const team of Object.values(SEED.teams)) {
      await expect(table.getByText(team.name)).toBeVisible();
    }
  });

  test("teams are sorted by points descending", async ({ page }) => {
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(6);

    // Expected order by points: Alpha(8), Beta(7), Gamma(6), Delta(4), Epsilon(2), Zeta(2)
    const expectedOrder = [
      SEED.teams.alpha.name,
      SEED.teams.beta.name,
      SEED.teams.gamma.name,
      SEED.teams.delta.name,
      // Epsilon and Zeta both have 2 points, tied at rank 5
      SEED.teams.epsilon.name,
      SEED.teams.zeta.name,
    ];

    for (let i = 0; i < expectedOrder.length; i++) {
      await expect(rows.nth(i)).toContainText(expectedOrder[i]);
    }
  });

  test("top 3 are displayed in the podium section", async ({ page }) => {
    // The podium renders above the table with rank badges "1st", "2nd", "3rd"
    const podium = page.locator("table").locator("..");
    await expect(page.getByText("1st")).toBeVisible();
    await expect(page.getByText("2nd")).toBeVisible();
    await expect(page.getByText("3rd")).toBeVisible();

    // Podium shows the top 3 team names
    // These appear outside the table, in the podium component
    const beforeTable = page.locator("section");
    await expect(beforeTable.getByText(SEED.teams.alpha.name).first()).toBeVisible();
    await expect(beforeTable.getByText(SEED.teams.beta.name).first()).toBeVisible();
    await expect(beforeTable.getByText(SEED.teams.gamma.name).first()).toBeVisible();
  });

  test("points values are correct for each team", async ({ page }) => {
    const table = page.locator("table");

    // Check each team's row contains the correct points value
    for (const team of Object.values(SEED.teams)) {
      const row = table.locator("tr", { hasText: team.name });
      await expect(row).toContainText(String(team.points));
    }
  });
});
