/**
 * Playwright global teardown: cleans up all E2E test data.
 * Runs after all test projects complete.
 */
import { test as teardown } from "@playwright/test";
import { cleanupE2EData } from "../helpers/cleanup";

teardown("cleanup all E2E test data", async () => {
  await cleanupE2EData();
});
