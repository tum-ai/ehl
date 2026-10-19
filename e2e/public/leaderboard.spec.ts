import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";
import { FINALE_WINNERS } from "../../lib/finale";

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

  test("podium shows the Grand Finale winners above the season table", async ({ page }) => {
    // The finale was decided on stage, so the podium shows the hardcoded
    // finale result (lib/finale.ts) and the points table is labelled as the
    // ranking going into the finale.
    await expect(page.getByRole("heading", { name: "Grand Finale Champions" })).toBeVisible();
    for (const name of FINALE_WINNERS) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "EHL Ranking going into the Finale" })
    ).toBeVisible();
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
