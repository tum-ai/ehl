/**
 * Regression for the admin dashboard blanking bug.
 *
 * The dashboard charts (Recharts ResponsiveContainer) threw on a 0/-1-sized
 * container during the ssr:false mount on some browsers, blanking the whole
 * admin content area. This asserts the dashboard renders its content AND charts
 * with no Recharts zero-size error — run on all three engines (the bug was
 * browser/timing dependent and surfaced on WebKit/Firefox in the field).
 */
import { test, expect } from "@playwright/test";
import { adminLoginViaSession } from "./sim-helpers";

test.describe("Simulation: admin dashboard charts (real UI, regression)", () => {
  test("dashboard renders content and charts without blanking", async ({ page }) => {
    const rechartsZeroErrors: string[] = [];
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /width\(-?\d+\) and height\(-?\d+\) of chart should be greater than 0/.test(m.text())
      ) {
        rechartsZeroErrors.push(m.text());
      }
    });

    await adminLoginViaSession(page);
    await page.goto("/admin", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    // Content area must not be blank (the bug left it empty under the sidebar).
    const mainText = (await page.locator("main").innerText().catch(() => "")) || "";
    expect(mainText, "admin content must not be blank").toContain("Dashboard");

    // Charts must actually render.
    const svgs = await page.locator(".recharts-wrapper svg, svg.recharts-surface").count();
    expect(svgs, "dashboard charts should render at least one SVG").toBeGreaterThan(0);

    // And no zero-size Recharts throw (the root cause).
    expect(rechartsZeroErrors, "no Recharts zero-size errors").toHaveLength(0);
  });
});
