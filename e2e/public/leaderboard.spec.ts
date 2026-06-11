import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Leaderboard page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/leaderboard");
  });

  test("page loads with heading and match count", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    await expect(page.getByText(/of \d+ matches completed/)).toBeVisible();
  });

  test("shows all seed teams in the table", async ({ page }) => {
    const table = page.locator("table");
    await expect(table).toBeVisible();

    // Assert each seed team is present. (We don't assert an exact row count:
    // the leaderboard also includes any E2E lifecycle teams when both test
    // projects run together, which is a test-isolation artifact, not a bug.)
    for (const team of Object.values(SEED.teams)) {
      await expect(table.getByText(team.name)).toBeVisible();
    }
  });

  test("seed teams appear in points-descending relative order", async ({ page }) => {
    const bodyText = (await page.locator("table tbody").innerText()).replace(/\s+/g, " ");

    // The seed teams, in expected points order. We check relative order within
    // the table text (robust to extra E2E teams interleaved by points).
    const order = [
      SEED.teams.alpha.name,   // 8
      SEED.teams.beta.name,    // 7
      SEED.teams.gamma.name,   // 6
      SEED.teams.delta.name,   // 4
      SEED.teams.epsilon.name, // 2
    ];
    const positions = order.map((name) => bodyText.indexOf(name));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("podium section renders the leader", async ({ page }) => {
    // The podium renders above the table. With the current standings two teams
    // tie for 1st (8 pts), so the podium shows the tied-for-1st layout rather
    // than distinct 1st/2nd/3rd badges. Assert the leader is shown.
    const beforeTable = page.locator("section");
    await expect(beforeTable.getByText(SEED.teams.alpha.name).first()).toBeVisible();
    // A podium rank label is present (1st always; 2nd/3rd only without ties).
    await expect(page.getByText("1st").first()).toBeVisible();
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
