import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.test for E2E tests (separate test Supabase instance)
config({ path: resolve(__dirname, ".env.test") });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1. Setup: create test users and authenticate
    {
      name: "setup",
      testDir: "./e2e/setup",
      testMatch: /global-setup\.ts/,
    },

    // 2. Lifecycle test: full hackathon flow (depends on setup)
    {
      name: "lifecycle",
      dependencies: ["setup"],
      testDir: "./e2e/lifecycle",
      use: { ...devices["Desktop Chrome"] },
    },

    // 3. Smoke tests: existing structural tests (depends on setup)
    {
      name: "smoke",
      dependencies: ["setup"],
      testDir: "./e2e",
      testIgnore: [
        "**/setup/**",
        "**/lifecycle/**",
      ],
      use: { ...devices["Desktop Chrome"] },
    },

    // 4. Cleanup: remove all E2E test data
    {
      name: "cleanup",
      dependencies: ["lifecycle", "smoke"],
      testDir: "./e2e/setup",
      testMatch: /global-teardown\.ts/,
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        // Start dev server with test environment variables on port 3001
        // (keeps port 3000 free for regular development)
        command: "dotenv -e .env.test -- pnpm dev --port 3001",
        url: "http://localhost:3001",
        reuseExistingServer: true,
      },
});
