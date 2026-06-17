/**
 * Simulation slice 1: real-UI participant registration + email verification.
 *
 * Proves the live stack end to end: real /register form -> real Turnstile path
 * (test keys) -> real verification email captured by Mailpit -> code entered in
 * the real UI -> authenticated session -> profile persisted.
 */
import { test, expect } from "@playwright/test";
import { registerSoloViaUI, loginViaUI, simEmail, expectProfileExists, clearMailbox, cleanupSimData } from "./sim-helpers";

test.describe("Simulation: registration (real UI)", () => {
  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("a solo participant registers through the real UI and is verified by email", async ({ page }) => {
    const email = simEmail("sim-solo-1");
    await registerSoloViaUI(page, { name: "Sim Solo One", email, lookingForTeam: true });
    await expect(page).toHaveURL(/\/(dashboard|event)/);
    await expectProfileExists(email);
  });

  test("the registered participant can log in again via the real login form", async ({ page }) => {
    const email = simEmail("sim-solo-1");
    await loginViaUI(page, email);
    await expect(page).toHaveURL(/\/(dashboard|event)/);
  });
});
