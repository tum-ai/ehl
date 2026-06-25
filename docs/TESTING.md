# E2E Testing: Architecture & Extension Guide

Complete documentation for the EHL E2E test pipeline. Read this before modifying or extending any test.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Test Environment](#3-test-environment)
4. [The Lifecycle Test](#4-the-lifecycle-test)
5. [How to Extend Tests](#5-how-to-extend-tests)
6. [Auth Strategy](#6-auth-strategy)
7. [Data Strategy](#7-data-strategy)
8. [External Services](#8-external-services)
9. [Troubleshooting](#9-troubleshooting)
10. [Rules](#10-rules)

---

## 1. Overview

The E2E test suite plays through the **entire hackathon lifecycle**: participant registration, chapter creation, applications, screening, challenge selection, submissions, jury voting, scoring, and public verification.

**Purpose**: Catch regressions when making changes. Security fixes have repeatedly broken features; this test prevents that.

**Run time**: ~2 minutes for 41 tests.

```bash
pnpm test:e2e:lifecycle      # The main test - run this before every commit
pnpm test:e2e                # Full suite: setup + lifecycle + smoke + cleanup
pnpm test                    # Unit tests only (Vitest)
```

---

## 2. Architecture

### File Structure

```
e2e/
  fixtures/
    supabase-admin.ts         # Standalone Supabase client (loads .env.test)
    test-assets/
      test-photo.png          # 1x1 PNG for photo upload test
  helpers/
    auth.ts                   # Login functions, E2E account constants, SEED data
    data-factory.ts           # Create test entities via admin API (idempotent)
    cleanup.ts                # Delete all e2e-* prefixed data
  setup/
    global-setup.ts           # Playwright setup: create users, authenticate, save state
    global-teardown.ts        # Playwright teardown: cleanup all test data
  lifecycle/
    hackathon-lifecycle.spec.ts   # THE lifecycle test (all blocks)
  auth/                       # Smoke tests: login/registration page structure
  admin/                      # Smoke tests: admin page structure
  jury/                       # Smoke tests: jury portal structure
  participant/                # Smoke tests: dashboard/event hub structure
  public/                     # Smoke tests: public page structure
```

### Playwright Projects (run order)

```
1. setup       → Creates test users, authenticates all roles, saves storageState
2. lifecycle   → Runs the full hackathon lifecycle (depends on setup)
   smoke       → Runs structural smoke tests (depends on setup, runs in parallel with lifecycle)
3. cleanup     → Deletes all E2E test data (depends on lifecycle + smoke)
```

### Data Flow

```
global-setup creates:
  - 1 admin user (magic link auth)
  - 1 team president + 1 member (email/password auth)
  - 1 solo participant / E2E Beta president (email/password auth)
  - 2 jury members (magic link auth)
  - Team "E2E Alpha" (president + member)
  - Team "E2E Beta" (solo user as president)

lifecycle test creates:
  - Chapter "E2E Match" (all status transitions)
  - Challenge "E2E Challenge"
  - Applications, screening scores
  - Chapter unlocks, challenge registrations
  - Submissions (2 teams)
  - Jury assignments, pitch order, rankings
  - Scores (published)

cleanup deletes:
  - Everything with e2e-* email prefix
  - Everything with "E2E " name prefix
  - Auth users from Supabase auth.users
```

---

## 3. Test Environment

Tests run against a **dedicated test Supabase instance** - never production.

| Component | Production | Test |
|-----------|-----------|------|
| Supabase | `your-prod-ref` | `your-test-ref` |
| Port | 3000 | 3001 |
| Env file | `.env.local` | `.env.test` |
| Data | Real users | e2e-* prefixed, auto-cleaned |

### Initial Setup (one-time)

```bash
# 1. Get .env.test from a teammate (or create from template in docs/SETUP.md section 13)
# 2. Run automated setup:
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm test:setup-supabase
```

This configures auth, storage, migrations, seed data - everything.

### How the Dev Server Works

Playwright starts a separate Next.js dev server on port 3001 with test env vars:
```
command: "dotenv -e .env.test -- pnpm dev --port 3001"
```

Your normal `pnpm dev` on port 3000 keeps running undisturbed.

---

## 4a. Full-UI Live Simulation (`e2e/simulation/`)

A separate, **fully-through-the-real-UI** simulation of a complete hackathon,
built to rehearse a live event (e.g. Paris). Unlike the lifecycle test (which
uses API/magic-link shortcuts for setup), every participant/jury/admin action
here is driven through real forms and buttons, and **email is read from a real
mail catcher (Mailpit)**, never from the DB.

**How it differs / what it needs:**
- Runs against a **production build** (`pnpm start`), not `pnpm dev`, so the real
  Turnstile verification path runs (with Cloudflare test keys from `.env.test`).
- SMTP is routed to **Mailpit** (`brew install mailpit`; SMTP :1025, HTTP API
  :8025). `e2e/helpers/mailpit.ts` polls the API for verification codes, magic
  links, invites, and confirmations.
- Env is `.env.e2e-live` (gitignored): `.env.test` with SMTP overridden to
  Mailpit plus the test admin in `ADMIN_FALLBACK_EMAILS`.
- Admin login: Google OAuth is disabled on the test Supabase, so only the admin
  login *handshake* is shortcut (magic-link callback); every admin **action** is
  done through the real admin UI.

**Run it (one command, sets up + tears down everything):**
```
pnpm test:sim            # migrate test DB, start Mailpit + prod server, run sim, teardown
pnpm test:sim --no-build # reuse the existing .next build
pnpm test:sim --keep-up  # leave server + Mailpit running after (for debugging)
```
Or, against an already-running stack:
```
node_modules/.bin/dotenv -e .env.e2e-live -- npx playwright test --config=playwright.sim.config.ts
```

Slices (`e2e/simulation/NN-*.sim.ts`) cover: registration, application + CV
upload, screening, team formation + invites, challenge registration + submission,
jury assignment + ranking, scoring + leaderboard, media upload, and a regression
for the admin "New Chapter" button. See `e2e/simulation/README.md` for the full
per-slice map and `e2e/simulation/FINDINGS.md` for app bugs found. The config
uses `retries: 1` to absorb transient slowness from driving a real live server.

## 4. The Lifecycle Test

The file `e2e/lifecycle/hackathon-lifecycle.spec.ts` contains **two** top-level blocks:

### Block 1: Registration (independent)
```
test.describe.serial("Block 1: Participant Registration")
  1.1 Solo registration with verification code
  1.2 Team registration with verification code
```

These tests create their own data and clean up after themselves. They don't depend on any shared state.

### Blocks 2-12: Main Lifecycle (serial, shared state)
```
test.describe.serial("Hackathon Lifecycle")
  2.1  Load user IDs from global setup
  2.2  Create chapter via API
  2.3  Admin sees chapter and advances status via UI
  3.1  Application page is accessible
  3.2  Submit applications via API
  4.1  Admin sees applications in screening view
  4.2  Accept applications and advance status
  4.3  Admin sees unlocked teams
  4.4  Walk-in: scans QR, registers + creates account in one step, then is checked in
  5.1  Admin sees challenge in list
  6.1  Register teams for challenge via API
  6.2  President sees challenge on event hub
  6.3  Advance to submissions_open
  7.1  Team Alpha submits project
  7.2  Team Beta submits project via API
  7.3  Verify submissions exist
  7.4  Lock submissions and advance to pitching
  8.1  Assign jury to challenge
  8.2  Generate pitch order
  8.3  Jury 1 accesses portal and sees submissions
  8.4  Jury 1 submits ranking
  8.5  Jury 2 submits ranking
  8.6  Verify jury rankings exist
  9.1  Create scores and publish
  9.2  Admin sees published scores
  10.1 Leaderboard shows E2E teams
  10.2 Chapter detail page shows completed status
  10.3 Matches page shows E2E chapter
  11.1 Admin photo upload page loads
  11.2 Upload test photo
  12.1-12.4 Cross-cutting auth guard checks
```

These tests share state via **module-level variables**:
```typescript
let chapterId: string;      // Set in 2.2, used everywhere after
let challengeId: string;    // Set in 4.2, used in 6+
let teamAlphaId: string;    // Set in 2.1, used throughout
// ... etc
```

**Critical**: Tests run sequentially. Test 7.1 depends on `chapterId` from 2.2 and `challengeId` from 4.2. If you insert a test between existing ones, verify the required variables are set.

**Walk-in step (4.4)**: drives the real `/walk-in/<token>` form. It reads the per-chapter
walk-in token via the `getWalkInToken(chapterId)` data-factory helper (reads/lazily creates
the admin-only `chapter_walk_in` row through the service-role client), fills the form +
password, and asserts the resulting application is `accepted` and a participant profile/auth
user exists for the RUN_ID-unique `e2e-walkin-${RUN_ID}@test-ehl.com`. It then runs the
existing admin check-in (`/admin/check-in`, manual token entry) on the walk-in's
`check_in_token` and asserts the row flips to `checked_in`. It runs at the end of Block 4 while
the chapter is in a check-in status (`challenge_selection`); the chapter cascade-deletes the
`chapter_walk_in` row at teardown.

---

## 5. How to Extend Tests

### Adding a Test for a New Feature

Example: You added a "team photo" feature. Here's how to test it.

**Step 1**: Add helper to `data-factory.ts` if needed:
```typescript
export async function uploadTeamPhoto(teamId: string, photoUrl: string) {
  const admin = getAdminClient();
  await admin.from("teams").update({ photo_url: photoUrl }).eq("id", teamId);
}
```

**Step 2**: Add test at the END of the relevant block in the lifecycle test:
```typescript
// Inside test.describe.serial("Hackathon Lifecycle")
// After existing Block 6 tests, before Block 7:

test("6.4 Team photo appears on event hub", async ({ page }) => {
  await loginAsParticipant(page, E2E_ACCOUNTS.president.email);
  await page.goto(`/event/${chapterSlug}`);
  await page.waitForLoadState("networkidle");
  
  // Check that team photo is visible
  await expect(page.locator('img[alt*="E2E Alpha"]')).toBeVisible({ timeout: 10000 });
});
```

**Step 3**: Run the tests and verify:
```bash
pnpm test:e2e:lifecycle
```

### Adding a Completely Independent Test

If your test doesn't need lifecycle state, add a new `test.describe` block (NOT serial) at the bottom:

```typescript
test.describe("Feature: Team Photos", () => {
  test("upload photo via admin panel", async ({ page }) => {
    // This test manages its own data
    const admin = getAdminClient();
    // ... setup, test, cleanup
  });
});
```

### Pattern: UI Test with API Fallback

The recommended pattern for testing UI flows:

```typescript
test("user submits form", async ({ page }) => {
  const admin = getAdminClient();
  
  // Try UI flow
  await loginAsParticipant(page, E2E_ACCOUNTS.president.email);
  await page.goto("/some-page");
  
  const formVisible = await page.locator('input[name="field"]')
    .isVisible({ timeout: 5000 }).catch(() => false);
  
  if (formVisible) {
    await page.locator('input[name="field"]').fill("value");
    await page.getByRole("button", { name: /submit/i }).click();
    await page.waitForTimeout(3000);
  }
  
  // Verify in DB (and fallback if UI didn't work)
  const { data } = await admin.from("table").select("*").eq("id", someId);
  if (!data?.length) {
    // API fallback: ensure the test can continue
    console.log("[Test] UI submission not saved, using API fallback");
    await admin.from("table").insert({ /* ... */ });
  }
  
  // Assert
  const { data: final } = await admin.from("table").select("*").eq("id", someId);
  expect(final).toBeTruthy();
});
```

This pattern ensures: (a) the UI is tested when it works, (b) subsequent tests don't break if the UI had a timing issue.

---

## 6. Auth Strategy

| Role | Method | Why |
|------|--------|-----|
| **Admin** | `loginAsAdmin(page)` - generates magic link, navigates to `/auth/callback` | Google OAuth can't be automated. The magic link auth is a shortcut that goes through the same callback handler. Uses `next=/dashboard` to bypass `isAdminEmail()` domain check (test emails use a different domain than the configured `ADMIN_EMAIL_DOMAIN`). |
| **Jury** | `loginAsJury(page, email)` - same magic link pattern | Mirrors production flow exactly. |
| **Participant** | `loginAsParticipant(page, email, password)` - fills login form | Tests the real login UI. Turnstile is bypassed in dev mode. |

### Creating New Test Users

Use `data-factory.ts`:
```typescript
const userId = await createParticipant({ email: "e2e-new@test-ehl.com", name: "E2E New" });
const adminId = await createAdmin({ email: "e2e-admin2@test-ehl.com", name: "E2E Admin 2" });
const juryId = await createJury({ email: "e2e-jury3@test-ehl.com", name: "E2E Jury 3" });
```

All creation functions are **idempotent**: they update if the user already exists.

### Session Handling

The `global-setup.ts` authenticates all users and saves `storageState` files to `.auth/`. However, the lifecycle test re-authenticates via `loginAsAdmin()` / `loginAsParticipant()` / `loginAsJury()` for each test because:
- StorageState files may expire during long test runs
- Re-authenticating is more realistic and catches auth bugs

---

## 7. Data Strategy

### Naming Convention

All test entities use recognizable prefixes:
- **Emails**: `e2e-*@test-ehl.com` (domain doesn't exist, emails bounce harmlessly)
- **Names**: `E2E *` (e.g., "E2E Alpha", "E2E Match", "E2E Challenge")
- **Slugs**: Auto-generated from names (e.g., `e2e-match`, `e2e-alpha`)

### Cleanup

The cleanup function (`e2e/helpers/cleanup.ts`) deletes everything matching these patterns:
1. Profiles with `%@test-ehl.com` email
2. Teams with `E2E %` name
3. Chapters with `E2E %` name
4. All related data (challenges, submissions, scores, etc.) via foreign key chains
5. Auth users matching `@test-ehl.com` email (including orphaned ones)

**Seed data is NEVER touched.** The cleanup only targets e2e-* prefixed data.

### JSONB Columns

Supabase JSONB columns (`roster`, `fields`, `tech_stack`, `ranking`, `order_list`, `submission_fields`) must be passed as **native JavaScript objects/arrays**, not JSON strings:

```typescript
// CORRECT
await admin.from("submissions").insert({
  fields: { repo: "https://github.com/..." },
  tech_stack: ["TypeScript", "Next.js"],
});

// WRONG (double-stringified)
await admin.from("submissions").insert({
  fields: JSON.stringify({ repo: "https://github.com/..." }),
});
```

---

## 8. External Services

| Service | Test Behavior | Config |
|---------|--------------|--------|
| **Supabase** | Separate test instance | `.env.test` credentials |
| **Turnstile** | Auto-bypassed in dev | `NODE_ENV=development` |
| **Rate Limiting** | In-memory fallback | No Redis credentials in `.env.test` |
| **SMTP** | Real emails sent to @test-ehl.com (bounce) | Same SMTP credentials as prod |
| **Google Drive** | Optional, skip if not configured | `GOOGLE_DRIVE_ROOT_FOLDER_ID` in `.env.test` |
| **GitHub** | Uses `e2e-test-submission` repo in EHL org | `GITHUB_TOKEN` + `GITHUB_ORG` in `.env.test` |
| **OpenRouter** | Not tested (code review is async) | Not configured in `.env.test` |

---

## 9. Troubleshooting

### "Port 3001 already in use"
A previous test run left the dev server running. Kill it:
```bash
lsof -ti :3001 | xargs kill -9
```

### "Could not find column X in schema cache"
After adding new migrations, the Supabase PostgREST cache is stale:
```bash
pnpm test:setup-db   # Re-applies migrations and reloads cache
```

### "password authentication failed"
The DB password in `.env.test` contains special characters. Ensure it's quoted:
```
SUPABASE_DB_PASSWORD="password-with-#-and-%"
```

### "Registration test hangs at 'Sending code...'"
SMTP is slow for non-existent domains. The test handles this gracefully (warns instead of failing). If it blocks other tests, check your SMTP credentials.

### "Admin redirected to /admin/login"
The admin auth shortcut uses `next=/dashboard` (not `/admin`) because the callback checks `isAdminEmail()` for the configured `ADMIN_EMAIL_DOMAIN` when `next=/admin`. Test emails use `@test-ehl.com` which doesn't match. If the admin profile doesn't exist yet, re-run `pnpm test:e2e -- --project=setup`.

### "Event hub: You must be checked in"
The event hub requires `application.status = 'checked_in'`. Test 4.2 sets this. If the test fails here, check that applications were created in test 3.2 with the correct `chapter_id`.

---

## 10. Rules

### What You Must Do
- Run `pnpm test:e2e:lifecycle` before every commit
- Add tests when adding features
- Use `e2e-*@test-ehl.com` emails and `E2E *` names for all test data
- Use `data-factory.ts` helpers instead of raw SQL
- When a step has an API fallback, the UI path must still be asserted: if the
  form/control is reachable, drive it and assert the DB row was created by the
  UI. Fall back to an API insert ONLY when a precondition genuinely prevents
  the UI from rendering, and push a `test.info().annotations` warning so the
  fallback is visible (never a silent pass). See lifecycle tests 7.1 and 8.4.
- Assert real outcomes (exact URL, exact DB values/counts), not just that a
  page loaded or an element is visible.

### What You Must Never Do
- Delete an existing test case
- Weaken an assertion (e.g., `toBe(2)` to `toBeGreaterThan(0)`)
- Change expected values without explicit approval
- Modify tests to make them pass instead of fixing the code
- Run tests against the production Supabase instance
- Hardcode UUIDs or emails outside of `auth.ts` constants
- Insert a test between existing serial tests without verifying variable dependencies
- Swallow a real failure into a green pass. Never `return` on a timeout/error
  branch or `catch(() => "ok")` around an assertion. If a flow can break, the
  test must go red. (A unit-test mock must likewise fail when the code queries
  a non-existent column — see `tests/admin-stats.test.ts`.)

---

## 11. Manual Testing on Staging (Preview Deployment + Test DB)

For changes that need a real-browser test on real infrastructure before
production (auth flows, emails, redirects), use the `staging` branch.

### How it works

- Pushing to the `staging` branch creates a Vercel preview deployment at
  **https://ehl-git-staging-tum-ai.vercel.app**
- Branch-scoped env vars (Vercel > Settings > Environment Variables,
  scoped to Preview / branch `staging`) point this deployment at the
  **test Supabase instance**, Cloudflare Turnstile **test keys**
  (always-pass), and `NEXT_PUBLIC_SITE_URL` set to the staging URL so
  auth links in emails stay on staging.
- SMTP is shared with production, so emails really send: use a real
  inbox you control for manual tests.
- The deployment is protected by Vercel Deployment Protection: open it
  in a browser where you are logged in to the Vercel team.

### Workflow

```bash
# Deploy your work to staging
git push origin my-branch:staging --force

# Optionally reset/seed the test DB first
pnpm test:setup-db
```

Then test manually in the browser. Test users you create are in the
test DB and can be wiped via `pnpm test:setup-db`.

### Caveats

- **Only `main` and `staging` auto-deploy** (`git.deploymentEnabled` in
  `vercel.json`). Preview env vars are shared with production, so an
  ad-hoc branch preview would hit the production database. To get a
  testable deployment, push your branch to `staging`. If the team owner
  rescopes the shared Supabase/SMTP/Turnstile env vars to
  Production-only and adds preview values for the test instance, this
  restriction can be lifted.
- Admin Google OAuth is not configured on the test Supabase instance;
  test admin flows locally (`pnpm test:e2e`) or via role-seeded users.
