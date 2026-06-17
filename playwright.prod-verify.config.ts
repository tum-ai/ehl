import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "path";

// PROD VERIFICATION ONLY. Loads .env.prod-verify (points at the PRODUCTION DB,
// SMTP -> Mailpit, test CAPTCHA keys). Runs the single prod-verify spec against
// a local prod build on :3002. Kept separate from the sim config so the normal
// simulation never accidentally loads prod credentials.
config({ path: resolve(__dirname, ".env.prod-verify") });

export default defineConfig({
  testDir: "./e2e/simulation",
  testMatch: /prod-verify-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
