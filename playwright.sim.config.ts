import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "path";

// Live-UI simulation runs against an ALREADY-RUNNING production build (port 3001)
// backed by the test Supabase, with SMTP -> Mailpit. We load .env.e2e-live so the
// admin client (for assertions) and Mailpit URL are configured. No webServer here:
// the prod server is started by scripts/sim-run.sh before this config runs.
config({ path: resolve(__dirname, ".env.e2e-live") });

export default defineConfig({
  testDir: "./e2e/simulation",
  testMatch: /.*\.sim\.ts/,
  fullyParallel: false,
  workers: 1,
  // One retry: this drives a real live server, so an occasional transient (a slow
  // server-action response under load surfacing as a browser alert + nav timeout)
  // should not fail the run. A test that needs >1 attempt is still reported as
  // "flaky" so we keep visibility. Logic failures fail on both attempts.
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report-sim", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Cross-browser matrix. Real attendees use Firefox and Safari (especially the
  // admin panel), so the simulation runs on all three. Set SIM_BROWSER to limit
  // to one (e.g. SIM_BROWSER=webkit) while debugging a single engine.
  projects: (() => {
    const all = [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
      { name: "firefox", use: { ...devices["Desktop Firefox"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ];
    const only = process.env.SIM_BROWSER;
    if (only && !all.some((p) => p.name === only)) {
      // Fail loudly instead of silently running zero tests (a green no-op run).
      throw new Error(
        `SIM_BROWSER="${only}" is not one of: ${all.map((p) => p.name).join(", ")}`
      );
    }
    return only ? all.filter((p) => p.name === only) : all;
  })(),
});
