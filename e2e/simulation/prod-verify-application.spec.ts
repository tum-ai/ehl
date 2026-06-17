/**
 * PROD VERIFICATION — runs against a local production build pointed at the
 * PRODUCTION database (port 3002), to confirm the post-migration prod schema
 * still serves a real application submission end to end through the real UI.
 *
 * Safety: submits ONE clearly-marked synthetic application (unique sim email).
 * Asserts it landed + the confirmation email arrived. Deletion of the synthetic
 * row is done by the surrounding script (delete WHERE email = the unique value);
 * this spec does NOT run any bulk cleanup and imports no cleanup helpers.
 *
 * NOT part of the normal sim suite (different filename, not *.sim.ts).
 */
import { test, expect } from "@playwright/test";
import { submitApplicationViaUI } from "./sim-helpers";
import { waitForEmail, clearMailbox } from "../helpers/mailpit";

const PROD_APPLY_EMAIL = process.env.PROD_VERIFY_EMAIL!; // injected by the runner

test("a new Paris application can be submitted through the real UI (prod schema)", async ({ page }) => {
  expect(PROD_APPLY_EMAIL, "PROD_VERIFY_EMAIL must be set").toBeTruthy();
  await clearMailbox();

  await submitApplicationViaUI(page, {
    slug: "paris",
    email: PROD_APPLY_EMAIL,
    firstName: "ZZVerify",
    lastName: "DeleteMe",
    withCv: true,
  });

  // The real apply flow shows a success state on submit.
  await expect(
    page.getByText(/application (submitted|received)|thank you|success/i).first()
  ).toBeVisible({ timeout: 20000 });

  // The confirmation email goes through the real email path (captured by Mailpit).
  const mail = await waitForEmail(PROD_APPLY_EMAIL, { timeoutMs: 25000 });
  expect(mail.Subject.length).toBeGreaterThan(0);
});
