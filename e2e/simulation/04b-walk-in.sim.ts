/**
 * Simulation slice 4b: real-UI WALK-IN registration (brand new, migration 00054).
 *
 * This is the day-of registration-desk flow for filling no-show spots. It is the
 * highest-risk feature in this release, so it is exercised end-to-end through the
 * real UI:
 *
 *   1. Admin opens /admin/chapters/<id>/walk-in and sees the QR + the public
 *      /walk-in/<token> link (the unguessable per-chapter token lives in the
 *      admin-only chapter_walk_in table).
 *   2. A walk-in (a fresh, LOGGED-OUT browser context) opens /walk-in/<token>,
 *      fills the application form AND creates an account in one step, and is
 *      accepted automatically.
 *   3. The success screen shows the walk-in's personal check-in token/QR, and the
 *      walk-in is logged in but cannot reach the event hub until checked in.
 *   4. The admin checks them in via the real /admin/check-in UI (chapter select +
 *      personal check-in token), after which the walk-in reaches the event hub.
 *
 * Runs after screening (the chapter is in a check-in status) and before challenge
 * selection, matching the real event order.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  advanceChapterStatusViaUI,
  fillApplicationFields,
  registerSoloViaUI,
  simEmail,
  adminClient,
  cleanupSimData,
  clearMailbox,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Walk-in Match";
const WALKIN_EMAIL = simEmail("sim-walkin");
const WALKIN_PASSWORD = "WalkInPass123!";
const EXISTING_EMAIL = simEmail("sim-walkin-existing");

test.describe("Simulation: walk-in registration (real UI)", () => {
  let chapterId: string;
  let slug: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin creates a chapter and advances it to a check-in status", async ({ page }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    chapterId = created.id;
    // Advance to `preparation`, which is a valid check-in AND walk-in status
    // (CHECK_IN_STATUSES includes it; walk-in submit only rejects draft/completed).
    // We deliberately stop at preparation rather than challenge_selection because
    // advancing to challenge_selection requires at least one challenge to exist
    // (validateChallengeSelectionReady) — a precondition unrelated to walk-ins.
    // preparation is also the realistic moment a no-show walk-in arrives.
    await advanceChapterStatusViaUI(page, chapterId, "preparation");
    const db = adminClient();
    const { data: ch } = await db.from("chapters").select("slug, status").eq("id", chapterId).single();
    slug = ch!.slug as string;
    expect(ch!.status).toBe("preparation");
  });

  test("admin walk-in page shows the QR and the public /walk-in/<token> link", async ({ page }) => {
    await adminLoginViaSession(page);
    await page.goto(`/admin/chapters/${chapterId}/walk-in`);

    await expect(page.getByRole("heading", { name: "Walk-In Registration" })).toBeVisible();
    await expect(page.getByText(CHAPTER_NAME)).toBeVisible();
    await expect(page.getByRole("img", { name: /walk-in registration qr code/i })).toBeVisible();

    // The page shows the full public URL; it must contain the per-chapter token.
    const linkText = await page.getByText(/\/walk-in\//).first().textContent();
    expect(linkText).toMatch(/\/walk-in\/[0-9a-f-]{36}$/i);

    // The DB has exactly one chapter_walk_in row for this chapter, and the token
    // in the URL matches it (proving the admin page created/uses the real row).
    const db = adminClient();
    const { data: rows } = await db.from("chapter_walk_in").select("walk_in_token").eq("chapter_id", chapterId);
    expect(rows).toHaveLength(1);
    const token = rows![0].walk_in_token as string;
    expect(linkText).toContain(token);
  });

  test("a walk-in registers + creates an account in one step and is auto-accepted", async ({ browser }) => {
    const db = adminClient();
    const { data: rows } = await db.from("chapter_walk_in").select("walk_in_token").eq("chapter_id", chapterId);
    const token = rows![0].walk_in_token as string;

    // Fresh, LOGGED-OUT context: a real walk-in has no session.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/walk-in/${token}`);

    // The page resolves the chapter from the token and shows its name.
    await expect(page.getByRole("heading", { name: "Walk-In Registration" })).toBeVisible();
    await expect(page.getByText(CHAPTER_NAME)).toBeVisible();

    // Account credentials.
    await page.locator('input[name="email"]').fill(WALKIN_EMAIL);
    await page.locator('input[name="password"]').fill(WALKIN_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(WALKIN_PASSWORD);
    // Application fields (shared ApplicationFields; CV always optional on walk-in).
    await fillApplicationFields(page, {
      firstName: "Walkin",
      lastName: "Tester",
      cvMode: "optional",
    });
    await page.getByRole("button", { name: /register & create account/i }).click();

    // Success screen: registered + the personal check-in QR image + the
    // "show this to a volunteer" instruction.
    await expect(page.getByText(/you're registered/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("img", { name: "Your check-in QR code" })).toBeVisible();
    await expect(page.getByText(/show this to a volunteer to check in/i)).toBeVisible();

    // DB: account + profile (participant) + auto-accepted application with a
    // personal check_in_token.
    const { data: prof } = await db.from("profiles").select("id, role").eq("email", WALKIN_EMAIL).maybeSingle();
    expect(prof, "walk-in profile created").toBeTruthy();
    expect(prof!.role).toBe("participant");

    const { data: app } = await db
      .from("applications")
      .select("id, status, check_in_token, first_name, last_name")
      .eq("chapter_id", chapterId)
      .eq("email", WALKIN_EMAIL)
      .maybeSingle();
    expect(app, "walk-in application created").toBeTruthy();
    expect(app!.status, "auto-accepted").toBe("accepted");
    expect(app!.check_in_token, "personal check-in token issued").toBeTruthy();
    expect(app!.first_name).toBe("Walkin");

    // The self-registration was audit-logged as a participant action, scoped to
    // THIS application + actor (not just "some walk-in event exists"). logEvent()
    // is deferred via after(), so poll for it.
    await expect
      .poll(async () => {
        const { data } = await db
          .from("event_log")
          .select("action")
          .eq("action", "application.walk_in_registered")
          .eq("entity_id", app!.id ?? "")
          .eq("actor_id", prof!.id as string)
          .eq("actor_type", "participant");
        return data?.length ?? 0;
      }, { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    // Before check-in, the walk-in (logged in) cannot reach the event hub: the
    // hub renders an explicit "Access Denied" gate, NOT the checked-in content.
    await page.goto(`/event/${slug}`);
    await expect(page.getByRole("heading", { name: "Access Denied" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("You are checked in for this event.")).toHaveCount(0);
    await ctx.close();
  });

  test("admin checks the walk-in in via the real check-in UI, then they reach the event hub", async ({ page, browser }) => {
    const db = adminClient();
    const { data: app } = await db
      .from("applications")
      .select("id, check_in_token")
      .eq("chapter_id", chapterId)
      .eq("email", WALKIN_EMAIL)
      .single();
    const checkInToken = app!.check_in_token as string;

    // Admin checks them in through the real /admin/check-in UI.
    await adminLoginViaSession(page);
    await page.goto("/admin/check-in");
    await page.waitForLoadState("networkidle");
    // The chapter select is populated by a client fetch; wait for its option.
    await expect(page.locator(`select option[value="${chapterId}"]`)).toBeAttached({ timeout: 15000 });
    await page.locator("select").selectOption(chapterId);
    await page.getByPlaceholder(/enter check-in token/i).fill(checkInToken);
    await page.getByRole("button", { name: /^check in$/i }).click();

    // DB: the application is now checked_in with who/when recorded.
    await expect
      .poll(async () => {
        const { data } = await db.from("applications").select("status, checked_in_at, checked_in_by").eq("id", app!.id).single();
        return data?.status;
      }, { timeout: 15000 })
      .toBe("checked_in");
    const { data: after } = await db.from("applications").select("checked_in_at, checked_in_by").eq("id", app!.id).single();
    expect(after!.checked_in_at, "checked_in_at set").toBeTruthy();
    expect(after!.checked_in_by, "checked_in_by recorded").toBeTruthy();

    // The check-in was audit-logged (logEvent is deferred via after(), so poll).
    await expect
      .poll(async () => {
        const { data } = await db
          .from("event_log")
          .select("action")
          .eq("entity_id", app!.id)
          .eq("action", "application.checked_in");
        return data?.length ?? 0;
      }, { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    // The walk-in (logged in via a fresh session) can now reach the event hub.
    // Log them in through the real login form to prove the account works.
    const ctx = await browser.newContext();
    const wp = await ctx.newPage();
    await wp.goto("/login");
    await wp.locator('input[name="email"]').fill(WALKIN_EMAIL);
    await wp.locator('input[name="password"]').fill(WALKIN_PASSWORD);
    await wp.getByRole("button", { name: /log ?in|sign ?in/i }).first().click();
    await wp.waitForURL(/\/dashboard/, { timeout: 20000 });
    await wp.goto(`/event/${slug}`);
    // Now checked in, the hub shows its real content (NOT the Access Denied gate):
    // the checked-in confirmation, and the gate heading is gone.
    await expect(wp.getByText("You are checked in for this event.")).toBeVisible({ timeout: 15000 });
    await expect(wp.getByRole("heading", { name: "Access Denied" })).toHaveCount(0);
    await ctx.close();
  });

  test("a SIGNED-IN existing user can walk in without 'already registered' dead-end (no account deletion)", async ({ browser }) => {
    // Regression for the reported event-day bug: an existing, signed-in user who
    // opens the walk-in link must NOT dead-end with "sign in first" / "already
    // registered". The walk-in page prefills + locks their email, hides the
    // password fields, and registers them against their EXISTING account.
    const db = adminClient();
    const { data: rows } = await db
      .from("chapter_walk_in")
      .select("walk_in_token")
      .eq("chapter_id", chapterId);
    const token = rows![0].walk_in_token as string;

    // A pre-existing registered participant (own context, signed in).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await registerSoloViaUI(page, { name: "Existing Walkin", email: EXISTING_EMAIL });
    // They have NO application for this chapter yet.
    const { data: prof } = await db.from("profiles").select("id").eq("email", EXISTING_EMAIL).single();

    // Open the walk-in link WHILE SIGNED IN.
    await page.goto(`/walk-in/${token}`);
    await expect(page.getByRole("heading", { name: "Walk-In Registration" })).toBeVisible();

    // The email is prefilled + locked, and there are NO password fields (the
    // signed-in account is reused).
    await expect(page.locator('input[name="email"]')).toHaveValue(EXISTING_EMAIL);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);

    // Fill the application fields (CV optional on walk-in) and submit.
    await fillApplicationFields(page, {
      firstName: "Existing",
      lastName: "Walkin",
      cvMode: "optional",
    });
    await page.getByRole("button", { name: /register & create account|register/i }).click();

    // Success: they get a personal check-in QR (NOT a "already registered" error).
    await expect(page.getByText(/you're registered/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("img", { name: "Your check-in QR code" })).toBeVisible();

    // DB: an ACCEPTED application now exists for the EXISTING account (no second
    // account was created — same profile id).
    const { data: app } = await db
      .from("applications")
      .select("status, check_in_token")
      .eq("chapter_id", chapterId)
      .eq("email", EXISTING_EMAIL)
      .maybeSingle();
    expect(app, "accepted application created for existing user").toBeTruthy();
    expect(app!.status).toBe("accepted");
    expect(app!.check_in_token).toBeTruthy();

    // Exactly ONE profile for this email (no duplicate account).
    const { count: profCount } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("email", EXISTING_EMAIL);
    expect(profCount).toBe(1);
    expect(prof!.id).toBeTruthy();

    // Idempotent: opening the walk-in link AGAIN returns the same check-in QR,
    // does not error, and creates no second application.
    await page.goto(`/walk-in/${token}`);
    await fillApplicationFields(page, {
      firstName: "Existing",
      lastName: "Walkin",
      cvMode: "optional",
    });
    await page.getByRole("button", { name: /register & create account|register/i }).click();
    await expect(page.getByRole("img", { name: "Your check-in QR code" })).toBeVisible({ timeout: 20000 });
    const { count: appCount } = await db
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapterId)
      .eq("email", EXISTING_EMAIL);
    expect(appCount, "still exactly one application (idempotent)").toBe(1);

    await ctx.close();
  });
});
