/**
 * Regression for the admin dashboard blanking bug.
 *
 * The dashboard charts (Recharts ResponsiveContainer) failed on a 0/-1-sized
 * container during the ssr:false mount on some browsers/timings — observed in
 * the field as a full client-render crash that blanked the whole admin content
 * area (and, via the shared React root + <Link> soft nav, every tab clicked
 * afterward). This asserts the dashboard renders its content AND charts with no
 * Recharts zero-size message.
 *
 * NOTE: this slice runs on whatever engines the sim config defines. The
 * cross-browser matrix (chromium + firefox + webkit) lands with the FF/WebKit
 * config change; until then this runs Chromium-only.
 */
import { test, expect } from "@playwright/test";
import { adminLoginViaSession } from "./sim-helpers";

test.describe("Simulation: admin dashboard charts (real UI, regression)", () => {
  test("dashboard renders content and charts without blanking", async ({ page }) => {
    // Recharts emits the zero-size message via console.warn (Playwright type
    // "warning"), not console.error — match BOTH so the assertion can actually
    // catch the regression.
    const rechartsZeroErrors: string[] = [];
    page.on("console", (m) => {
      if (
        (m.type() === "warning" || m.type() === "error") &&
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
