/**
 * Helpers for the full-UI hackathon simulation.
 *
 * Principle: drive the REAL UI for every action a human takes (forms, buttons,
 * navigation). Use the DB/admin API only for assertions and for setup that has
 * no UI (e.g. seeding nothing — the simulation creates everything through the UI).
 *
 * Email (verification codes, magic links, confirmations) is read from Mailpit
 * (the real email path), never from the DB shortcut.
 */
import { type Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateMagicLink } from "../helpers/data-factory";
import {
  waitForEmail,
  extractVerificationCode,
  extractLink,
  clearMailbox,
} from "../helpers/mailpit";

export const SIM_PASSWORD = "SimPass123!";

// Unique run namespace so repeated runs don't collide and cleanup is targeted.
// All simulated people use @sim-ehl.com so teardown can match them.
export const SIM_DOMAIN = "sim-ehl.com";

// A per-process run token. workers=1 and a shared worker process mean every
// .sim.ts file in a single `playwright test` invocation sees the SAME token, so
// emails are stable within a run but unique across runs. This matters because
// any sim participant who performs a logged action writes an immutable
// event_log row (append-only trigger) that holds a FK to their profile — such
// profiles can never be hard-deleted, so we must not collide with them on the
// next run. cleanupSimData() still removes everything it can; fresh emails make
// leftover event-logged profiles harmless.
export const SIM_RUN =
  process.env.SIM_RUN || `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function simEmail(local: string): string {
  return `${local}-${SIM_RUN}@${SIM_DOMAIN}`;
}

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export { waitForEmail, extractVerificationCode, extractLink, clearMailbox };

/**
 * Register a brand-new SOLO participant entirely through the /register UI:
 * fill the form, receive the verification code by email (Mailpit), enter it,
 * land authenticated. Returns nothing; the page is left logged in.
 */
export async function registerSoloViaUI(
  page: Page,
  opts: { name: string; email: string; lookingForTeam?: boolean }
): Promise<void> {
  const since = new Date().toISOString();
  await page.goto("/register");

  // Mode picker: choose the Solo card first (the form only renders after this).
  await page.getByRole("button", { name: /register solo/i }).first().click();

  // Step 1: details form. Labels are not htmlFor-associated, so select by name.
  await page.locator('input[name="name"]').fill(opts.name);
  await page.locator('input[name="email"]').fill(opts.email);
  await page.locator('input[name="password"]').fill(SIM_PASSWORD);
  if (opts.lookingForTeam) {
    const lft = page.locator('input[name="lookingForTeam"]');
    if (await lft.count()) await lft.check().catch(() => {});
  }
  // Step 1 submit is "Continue" (sends the verification code email).
  await page.getByRole("button", { name: /^continue$/i }).first().click();

  // Step 2: verification code from the real email (Mailpit).
  const email = await waitForEmail(opts.email, { sinceISO: since });
  const code = extractVerificationCode(email);
  await page.locator('input[placeholder="000000"]').fill(code);
  await page.getByRole("button", { name: /verify & register|verify|register/i }).first().click();

  await page.waitForURL(/\/(dashboard|event)/, { timeout: 20000 });
}

/**
 * Log in an existing participant via the real /login form (email + password).
 */
export async function loginViaUI(page: Page, email: string): Promise<void> {
  // The /login form uses Turnstile + a server-action redirect, which can be
  // intermittently slow to navigate in headless Chromium. Submit, wait for the
  // post-login URL, and retry the submit once if the first attempt stalls
  // (e.g. the Turnstile token wasn't attached yet). Still the real login UI.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(SIM_PASSWORD);
    await page.getByRole("button", { name: /sign ?in|log ?in/i }).first().click();
    try {
      await page.waitForURL(/\/(dashboard|event)/, { timeout: 15000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginViaUI: did not reach dashboard for ${email}`);
    }
  }
}

/**
 * Jury login through the real /jury/login UI: submit email, click the magic
 * link delivered to Mailpit, land in the jury portal.
 *
 * The jury login form's <label> is not htmlFor-associated, so we select the
 * email input by type, not by label.
 */
export async function juryLoginViaUI(page: Page, email: string): Promise<void> {
  // Submit the real jury login form, wait for the "Check your email"
  // confirmation (so we know signInJury succeeded, not a stalled Turnstile
  // submit), then click the magic link from Mailpit. Retry the submit once if
  // the confirmation doesn't appear.
  let since = new Date().toISOString();
  for (let attempt = 0; attempt < 2; attempt++) {
    since = new Date().toISOString();
    await page.goto("/jury/login");
    await page.locator('input[type="email"]').first().fill(email);
    await page.getByRole("button", { name: /send|magic|log ?in|continue/i }).first().click();
    try {
      await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 12000 });
      break;
    } catch {
      if (attempt === 1) throw new Error(`juryLoginViaUI: login form did not confirm send for ${email}`);
    }
  }
  const mail = await waitForEmail(email, { sinceISO: since, subjectIncludes: "Jury Portal login" });
  const link = extractLink(mail, "/auth/callback");
  await page.goto(link);
  await page.waitForURL(/\/jury/, { timeout: 20000 });
}

/**
 * Establish an ADMIN session for the live simulation.
 *
 * Real Google OAuth is disabled on the test Supabase, so the LOGIN HANDSHAKE
 * (and only the handshake) is shortcut via a magic-link callback for the
 * pre-provisioned admin (e2e-admin@test-ehl.com, an admin via
 * ADMIN_FALLBACK_EMAILS). Every admin ACTION after this is performed through
 * the real admin UI (clicking real buttons/forms).
 *
 * We route through next=/dashboard (not /admin) because the callback's
 * isAdminEmail() check for next=/admin requires the admin email domain;
 * the @test-ehl.com admin instead relies on its profile role='admin', which
 * the callback honors and then redirects to /admin.
 */
export const SIM_ADMIN_EMAIL =
  process.env.SIM_ADMIN_EMAIL || "e2e-admin@test-ehl.com";

export async function adminLoginViaSession(page: Page): Promise<void> {
  // Magic-link tokens are single-use and short-lived; a stale/raced token lands
  // on /login?error=auth_failed. Generate a FRESH link per attempt and retry a
  // couple of times so a transient OTP failure doesn't fail the run.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const magicLinkUrl = await generateMagicLink(SIM_ADMIN_EMAIL, "/dashboard");
    await page.goto(magicLinkUrl);
    try {
      await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 });
      if (!page.url().includes("/admin")) {
        await page.goto("/admin");
        await page.waitForURL(/\/admin/, { timeout: 15000 });
      }
      return;
    } catch (e) {
      lastErr = e;
      // If we got bounced to an auth error, loop with a brand-new token.
      if (!/error=auth_failed|\/login/.test(page.url())) throw e;
    }
  }
  throw new Error(`adminLoginViaSession failed after retries: ${String(lastErr)}`);
}

/**
 * A minimal but valid one-page PDF as a Buffer. Used for CV uploads so the
 * simulation never depends on a fixture file on disk.
 */
export function tinyPdfBuffer(): Buffer {
  const pdf =
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n" +
    "trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n";
  return Buffer.from(pdf, "utf-8");
}

/**
 * A minimal valid 1x1 PNG as a Buffer (for media uploads).
 */
export function tinyPngBuffer(): Buffer {
  // 1x1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
}

// ─── Admin chapter helpers (real UI) ─────────────────────────
//
// All driven through the real admin chapter create + edit + status-control UI.
// The chapter is always named "Sim <suffix>" so cleanupSimData() removes it.

/** Future ISO datetime-local string (YYYY-MM-DDTHH:mm) `days` from now. */
function futureLocalDatetime(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Future YYYY-MM-DD `days` from now (for exact start/end date pickers). */
function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Bootstrap a blank DRAFT chapter row directly via the admin client.
 *
 * This is the ONE chapter step with no working UI: the real admin "New Chapter"
 * button is broken on a correctly-migrated schema (see FINDINGS.md #1 —
 * createNewChapter() omits the NOT NULL match_number). We insert the draft row
 * here (supplying match_number) and then drive every subsequent admin action
 * through the real UI. Always named "Sim %" so cleanup removes it.
 */
export async function createDraftChapterRow(name: string): Promise<{ id: string }> {
  const db = adminClient();
  const slug = `sim-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  // High match_number keeps it out of the way of seeded matches; the edit form's
  // recalculateMatchNumbers will re-order by date on first save.
  const { data, error } = await db
    .from("chapters")
    .insert({
      name,
      slug,
      city: "",
      country: "",
      country_code: "DE",
      description: "",
      status: "draft",
      is_finale: false,
      match_number: 990 + Math.floor(Math.random() * 9),
      challenge_registration_enabled: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createDraftChapterRow failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * Create a chapter and fill in all the details + deadlines the status flow
 * needs, through the real chapter edit form. The draft row is bootstrapped via
 * the admin client (createNewChapter UI is broken — FINDINGS.md #1); everything
 * else is the real UI. The admin page must already be authenticated.
 *
 * The edit form inputs have no name attributes; we locate them by their visible
 * label text via the surrounding markup.
 */
export async function createChapterViaUI(
  page: Page,
  opts: { name: string; city?: string; country?: string; description?: string }
): Promise<{ id: string }> {
  const { id } = await createDraftChapterRow(opts.name);
  await page.goto(`/admin/chapters/${id}`);
  await page.waitForURL(/\/admin\/chapters\/[0-9a-f-]+$/, { timeout: 20000 });

  // Fill the Details form. Inputs are the first text inputs under each label.
  // Name is the first text input in the Details card.
  const setByLabel = async (label: string, value: string) => {
    const input = page.locator(
      `xpath=//label[normalize-space(.)="${label}"]/following-sibling::input[1]`
    );
    await input.fill(value);
  };

  await setByLabel("Name", opts.name);
  await setByLabel("City", opts.city ?? "Sim City");
  await setByLabel("Country", opts.country ?? "Germany");

  // Description is a textarea following its label.
  await page
    .locator('xpath=//label[normalize-space(.)="Description"]/following-sibling::textarea[1]')
    .fill(opts.description ?? "Sim chapter for live-UI simulation.");

  // Switch date mode to Exact and set start + end dates.
  await page.getByRole("button", { name: /exact dates/i }).click();
  await page.locator('input[type="date"]').first().fill(futureDate(30));
  await page.locator('input[type="date"]').nth(1).fill(futureDate(31));

  // Deadlines (datetime-local inputs, in order: application, challenge sel, submission).
  const dts = page.locator('input[type="datetime-local"]');
  await dts.nth(0).fill(futureLocalDatetime(20));
  await dts.nth(1).fill(futureLocalDatetime(29));
  await dts.nth(2).fill(futureLocalDatetime(31));

  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText(/chapter saved/i)).toBeVisible({ timeout: 15000 });

  return { id };
}

/**
 * Advance a chapter to `target` through the real status-control UI, stepping
 * one status at a time and accepting each confirm() dialog. The status control
 * shows status buttons by their label; clicking one fires window.confirm.
 *
 * Supported targets correspond to the status-control STATUS_FLOW labels.
 */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  announced: "Announced",
  applications_open: "Applications Open",
  preparation: "Preparation",
  challenge_selection: "Challenge Selection",
  submissions_open: "Submissions Open",
  pitching: "Pitching",
  completed: "Completed",
};
const STATUS_SEQUENCE = [
  "draft",
  "announced",
  "applications_open",
  "preparation",
  "challenge_selection",
  "submissions_open",
  "pitching",
  "completed",
];

export async function advanceChapterStatusViaUI(
  page: Page,
  chapterId: string,
  target: string,
  opts: { from?: string } = {}
): Promise<void> {
  const targetIdx = STATUS_SEQUENCE.indexOf(target);
  const fromIdx = STATUS_SEQUENCE.indexOf(opts.from ?? "draft");
  if (targetIdx < 0) throw new Error(`Unknown target status ${target}`);

  await page.goto(`/admin/chapters/${chapterId}`);
  // Auto-accept the confirm() dialogs the status control raises.
  page.on("dialog", (d) => d.accept());

  const db = adminClient();
  for (let i = fromIdx + 1; i <= targetIdx; i++) {
    const status = STATUS_SEQUENCE[i];
    const label = STATUS_LABELS[status];
    const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
    await btn.click();
    // The success toast auto-dismisses (3s); rather than racing it, confirm the
    // persisted status in the DB. If the transition was blocked, this poll
    // times out and surfaces the readiness failure.
    await expect
      .poll(async () => {
        const { data } = await db.from("chapters").select("status").eq("id", chapterId).single();
        return data?.status ?? null;
      }, { timeout: 15000 })
      .toBe(status);
  }
}

/** Read a chapter's slug from the DB by name (sim chapters use "Sim %"). */
export async function getChapterSlugByName(name: string): Promise<string> {
  const db = adminClient();
  const { data } = await db.from("chapters").select("slug").eq("name", name).maybeSingle();
  if (!data?.slug) throw new Error(`No chapter named "${name}"`);
  return data.slug as string;
}

/** Read a chapter's id from the DB by name. */
export async function getChapterIdByName(name: string): Promise<string> {
  const db = adminClient();
  const { data } = await db.from("chapters").select("id").eq("name", name).maybeSingle();
  if (!data?.id) throw new Error(`No chapter named "${name}"`);
  return data.id as string;
}

/**
 * Create a challenge through the real admin challenge UI for the given chapter.
 *
 * To keep the simulation independent of GitHub, the challenge's submission
 * fields are reduced to a single non-repo `url` field ("Demo URL") and the
 * automatic-code-review toggle is turned off (an enabled-but-unconfigured code
 * review would otherwise block the submissions_open status transition).
 *
 * The admin page must already be authenticated.
 */
export async function createChallengeViaUI(
  page: Page,
  chapterId: string,
  opts: { title: string }
): Promise<void> {
  await page.goto(`/admin/chapters/${chapterId}/challenges`);
  await page.getByRole("button", { name: /\+ new challenge/i }).click();

  await page.locator('input[placeholder="Challenge title"]').fill(opts.title);
  await page
    .locator('textarea[placeholder="What teams should build..."]')
    .fill("Build something great. Sim challenge.");

  // Turn OFF automatic code review (its config gate would block submissions_open).
  const reviewToggle = page
    .locator("div", { hasText: /^Automatic Code Review/ })
    .getByRole("switch")
    .last();
  if ((await reviewToggle.getAttribute("aria-checked")) === "true") {
    await reviewToggle.click();
  }

  // Reduce submission fields to one non-repo URL field. Remove every default
  // field row, then add a single "Demo URL" url field.
  // Each field row has a "Remove" button; remove until none remain.
  const removeButtons = page.getByRole("button", { name: /^remove$/i });
  // Click the first Remove repeatedly until the field rows are gone.
  for (let guard = 0; guard < 10; guard++) {
    const count = await removeButtons.count();
    if (count === 0) break;
    await removeButtons.first().click();
  }

  await page.getByRole("button", { name: /\+ add field/i }).click();
  await page.locator('input[placeholder="key"]').fill("demo");
  await page.locator('input[placeholder="Label"]').fill("Demo URL");
  // The type <select> defaults to "url" (first option) — leave it.

  await page.getByRole("button", { name: /^create challenge$/i }).click();

  // The new challenge appears in the list. Confirm in the DB too.
  const db = adminClient();
  await expect
    .poll(async () => {
      const { count } = await db
        .from("challenges")
        .select("id", { count: "exact", head: true })
        .eq("chapter_id", chapterId)
        .eq("title", opts.title);
      return count ?? 0;
    }, { timeout: 15000 })
    .toBeGreaterThan(0);
}

/** Get the single challenge id for a chapter by its title. */
export async function getChallengeId(chapterId: string, title: string): Promise<string> {
  const db = adminClient();
  const { data } = await db
    .from("challenges")
    .select("id")
    .eq("chapter_id", chapterId)
    .eq("title", title)
    .maybeSingle();
  if (!data?.id) throw new Error(`No challenge "${title}" in chapter ${chapterId}`);
  return data.id as string;
}

/**
 * Bootstrap a registered team + a submission for a challenge directly via the
 * admin client. Used as a precondition for the jury/scoring slices, whose
 * subject is the jury/scoring UI (submission creation is itself covered through
 * the real UI in slice 05). Returns the created team id.
 */
export async function bootstrapSubmission(opts: {
  chapterId: string;
  challengeId: string;
  teamName: string;
  presidentUserId: string;
  projectName?: string;
}): Promise<{ teamId: string }> {
  const db = adminClient();
  const slug = `${opts.teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const { data: team, error: teamErr } = await db
    .from("teams")
    .insert({
      name: opts.teamName,
      slug,
      university: "Sim University",
      president_user_id: opts.presidentUserId,
    })
    .select("id")
    .single();
  if (teamErr) throw new Error(`bootstrapSubmission team failed: ${teamErr.message}`);
  const teamId = team.id as string;

  await db.from("team_members").insert({
    team_id: teamId,
    user_id: opts.presidentUserId,
    role: "president",
  });
  await db.from("challenge_registrations").insert({
    chapter_id: opts.chapterId,
    challenge_id: opts.challengeId,
    team_id: teamId,
    roster: [opts.presidentUserId],
  });
  const { error: subErr } = await db.from("submissions").insert({
    challenge_id: opts.challengeId,
    team_id: teamId,
    project_name: opts.projectName ?? "Sim Submission",
    short_description: "A sim project for jury evaluation.",
    fields: { demo: "https://demo.sim-ehl.com" },
    tech_stack: ["Next.js"],
  });
  if (subErr) throw new Error(`bootstrapSubmission submission failed: ${subErr.message}`);

  return { teamId };
}

/**
 * Assign a jury member to a challenge through the real admin jury UI: fill the
 * name + email, pick the match + challenge from the selects, and send the
 * invitation (which also emails a magic link). The admin page must already be
 * authenticated.
 */
export async function assignJuryViaUI(
  page: Page,
  opts: { chapterId: string; challengeId: string; juryName: string; juryEmail: string }
): Promise<void> {
  await page.goto("/admin/jury");
  await page.locator('input[placeholder="Jury member name"]').fill(opts.juryName);
  await page.locator('input[placeholder="jury@sponsor.com"]').fill(opts.juryEmail);
  // First select is Match (value = chapter id), second is Challenge.
  const selects = page.locator("select");
  await selects.nth(0).selectOption(opts.chapterId);
  await selects.nth(1).selectOption(opts.challengeId);
  await page.getByRole("button", { name: /send invitation/i }).click();

  const db = adminClient();
  await expect
    .poll(async () => {
      const { count } = await db
        .from("jury_assignments")
        .select("user_id", { count: "exact", head: true })
        .eq("challenge_id", opts.challengeId);
      return count ?? 0;
    }, { timeout: 15000 })
    .toBeGreaterThan(0);
}

/**
 * Submit a jury ranking through the real jury ranking UI for a chapter where
 * exactly one team is eligible (maxSlots === 1). The page must be authenticated
 * as the assigned jury member. Navigates to the rank page, places the team in
 * the single slot, opens the confirmation modal, and submits the vote.
 */
export async function submitSingleTeamRankingViaUI(
  page: Page,
  opts: { slug: string; teamName: string }
): Promise<void> {
  await page.goto(`/jury/${opts.slug}`);
  await page.getByRole("link", { name: /enter ranking|update vote|vote instead/i }).click();
  await page.waitForURL(new RegExp(`/jury/${opts.slug}/rank`), { timeout: 20000 });

  // Place the team into the single slot from the Available Teams list.
  const teamBtn = page.getByRole("button", { name: new RegExp(opts.teamName, "i") }).first();
  await expect(teamBtn).toBeVisible({ timeout: 20000 });
  await teamBtn.click();

  // Once the slot is filled the main Submit Vote button is enabled.
  const mainSubmit = page.getByRole("button", { name: /^submit vote$/i });
  await expect(mainSubmit).toBeEnabled({ timeout: 10000 });
  await mainSubmit.click();

  // Confirmation modal → confirm. The modal replaces the main button, so the
  // remaining Submit Vote is the modal's. On success the page navigates back to
  // /jury/<slug>; wait for that so we know the vote actually persisted.
  const confirmSubmit = page.getByRole("button", { name: /^submit vote$/i }).last();
  await expect(confirmSubmit).toBeVisible({ timeout: 10000 });
  await confirmSubmit.click();
  await page.waitForURL(new RegExp(`/jury/${opts.slug}$`), { timeout: 20000 });
}

/**
 * Bootstrap a team whose members are ACCEPTED + CHECKED IN for a chapter.
 *
 * Check-in is the gating precondition for the event hub, and it has no clean
 * participant-facing UI (it is admin QR/name-search of an accepted application
 * + a check_in_token). So this step is bootstrapped via the admin client; the
 * challenge registration and submission that follow are driven through the real
 * UI. Each member is a real registered participant (created via the UI by the
 * caller); here we only add the accepted+checked_in application rows + team.
 *
 * Returns the team id. The president is members[0].
 */
export async function bootstrapCheckedInTeam(opts: {
  chapterId: string;
  teamName: string;
  members: { userId: string; email: string }[];
}): Promise<{ teamId: string }> {
  const db = adminClient();
  const slug = `${opts.teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

  const { data: team, error: teamErr } = await db
    .from("teams")
    .insert({
      name: opts.teamName,
      slug,
      university: "Sim University",
      president_user_id: opts.members[0].userId,
    })
    .select("id")
    .single();
  if (teamErr) throw new Error(`bootstrap team failed: ${teamErr.message}`);
  const teamId = team.id as string;

  for (let i = 0; i < opts.members.length; i++) {
    const m = opts.members[i];
    await db.from("team_members").insert({
      team_id: teamId,
      user_id: m.userId,
      role: i === 0 ? "president" : "member",
    });
    // Accepted + checked-in application for this chapter, matched by email.
    await db.from("applications").insert({
      chapter_id: opts.chapterId,
      email: m.email.toLowerCase(),
      first_name: "Sim",
      last_name: `Member${i}`,
      form_data: {},
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
    });
  }

  return { teamId };
}

/**
 * Submit a full application through the real /apply/<slug> form as an
 * ANONYMOUS applicant (email entered + blurred to reveal the form). All
 * required fields are filled. Optionally uploads a PDF CV. Asserts the success
 * screen. Returns nothing; the application row will exist in the DB.
 */
export async function submitApplicationViaUI(
  page: Page,
  opts: { slug: string; email: string; firstName: string; lastName: string; withCv?: boolean }
): Promise<void> {
  await page.goto(`/apply/${opts.slug}`);
  await page.locator('input[name="email"]').fill(opts.email);
  await page.locator('input[name="email"]').blur();

  await page.locator('input[name="firstName"]').fill(opts.firstName);
  await page.locator('input[name="lastName"]').fill(opts.lastName);
  await page.locator('input[name="dateOfBirth"]').fill("2000-01-15");
  await page.getByText("Male", { exact: true }).click();
  await page.locator('input[name="locationCity"]').fill("Munich");
  await page.locator('input[name="locationCountry"]').fill("Germany");
  await page.locator('input[name="nationality"]').fill("German");

  // Academic: not currently studying (keeps form short).
  await page.getByText("No", { exact: true }).first().click();

  await page
    .getByText("Do you have any programming skills?")
    .locator("xpath=ancestor::div[1]")
    .getByText("Yes", { exact: true })
    .click();
  await page
    .getByText("Are you a TUM.ai member?")
    .locator("xpath=ancestor::div[1]")
    .getByText("No", { exact: true })
    .click();
  await page
    .locator('textarea[name="hackathonExperience"]')
    .fill("Attended two hackathons previously and enjoy building fast.");

  await page
    .getByText("Do you already have a team?")
    .locator("xpath=ancestor::div[1]")
    .getByText("No", { exact: true })
    .click();

  await page.getByText("None", { exact: true }).click();
  await page.getByText("Men's", { exact: true }).click();
  await page.getByText("M", { exact: true }).click();
  await page.getByText("LinkedIn", { exact: true }).click();

  if (opts.withCv) {
    await page
      .getByText("Do you want to upload your CV?")
      .locator("xpath=ancestor::div[1]")
      .getByText("Yes", { exact: true })
      .click();
    await page.locator('input[name="cv"]').setInputFiles({
      name: "cv.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdfBuffer(),
    });
  } else {
    await page
      .getByText("Do you want to upload your CV?")
      .locator("xpath=ancestor::div[1]")
      .getByText("No", { exact: true })
      .click();
  }

  await page.getByRole("button", { name: /submit application/i }).click();
  await expect(page.getByText(/application submitted/i)).toBeVisible({ timeout: 20000 });
}

/** Assert a profile row exists for an email (DB-level confirmation). */
export async function expectProfileExists(email: string): Promise<void> {
  const db = adminClient();
  const { data } = await db.from("profiles").select("id,email,role").eq("email", email.toLowerCase()).maybeSingle();
  expect(data, `profile for ${email} should exist`).toBeTruthy();
}

// ─── Cleanup ─────────────────────────────────────────────────
//
// Removes everything the simulation creates so each run starts clean and
// repeated runs don't collide. Matches ONLY the simulation namespaces:
//   - profiles/auth/applications/verification_codes by @sim-ehl.com email
//   - chapters / teams / challenges named "Sim %"
// The shared e2e-* accounts (admin, jury fixtures) are NEVER deleted.

const SIM_EMAIL_PATTERN = `%@${SIM_DOMAIN}`;
const SIM_NAME_PATTERN = "Sim %";

export async function cleanupSimData(): Promise<void> {
  const db = adminClient();

  // 1. Sim profiles → user IDs + emails
  const { data: profiles } = await db
    .from("profiles")
    .select("id, email")
    .like("email", SIM_EMAIL_PATTERN);
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  const profileEmails = (profiles ?? []).map((p) => p.email as string);

  // 2. Sim chapters / teams
  const { data: chapters } = await db.from("chapters").select("id").like("name", SIM_NAME_PATTERN);
  const chapterIds = (chapters ?? []).map((c) => c.id as string);
  const { data: teams } = await db.from("teams").select("id").like("name", SIM_NAME_PATTERN);
  const teamIds = (teams ?? []).map((t) => t.id as string);

  // 3. Challenges in sim chapters
  let challengeIds: string[] = [];
  if (chapterIds.length > 0) {
    const { data: challenges } = await db.from("challenges").select("id").in("chapter_id", chapterIds);
    challengeIds = (challenges ?? []).map((c) => c.id as string);
  }

  // Delete in reverse-dependency order.
  if (challengeIds.length > 0) {
    await db.from("pitch_orders").delete().in("challenge_id", challengeIds);
    await db.from("jury_feedback").delete().in("challenge_id", challengeIds);
    await db.from("jury_rankings").delete().in("challenge_id", challengeIds);
    await db.from("code_reviews").delete().in("challenge_id", challengeIds);
    await db.from("submissions").delete().in("challenge_id", challengeIds);
    await db.from("challenge_registrations").delete().in("challenge_id", challengeIds);
  }

  // Jury assignments for sim challenges AND any jury assigned to sim chapters.
  if (challengeIds.length > 0) {
    await db.from("jury_assignments").delete().in("challenge_id", challengeIds);
  }
  if (chapterIds.length > 0) {
    await db.from("jury_assignments").delete().in("chapter_id", chapterIds);
  }
  // Jury assignments referencing sim USERS (sim jury), regardless of chapter.
  if (profileIds.length > 0) {
    await db.from("jury_assignments").delete().in("user_id", profileIds);
  }

  if (chapterIds.length > 0) {
    await db.from("challenges").delete().in("chapter_id", chapterIds);
    await db.from("scores").delete().in("chapter_id", chapterIds);
    await db.from("media").delete().in("chapter_id", chapterIds);
    await db.from("partners").delete().in("chapter_id", chapterIds);
  }

  // Applications by sim email (covers both logged-in and anonymous applicants).
  if (profileEmails.length > 0) {
    const { data: apps } = await db.from("applications").select("id").in("email", profileEmails);
    const appIds = (apps ?? []).map((a) => a.id as string);
    if (appIds.length > 0) {
      await db.from("screening_scores").delete().in("application_id", appIds);
    }
    await db.from("applications").delete().in("email", profileEmails);
  }
  // Also any application created directly with a sim email (anonymous apply).
  const { data: simApps } = await db.from("applications").select("id").like("email", SIM_EMAIL_PATTERN);
  const simAppIds = (simApps ?? []).map((a) => a.id as string);
  if (simAppIds.length > 0) {
    await db.from("screening_scores").delete().in("application_id", simAppIds);
    await db.from("applications").delete().like("email", SIM_EMAIL_PATTERN);
  }

  if (chapterIds.length > 0) {
    await db.from("chapters").delete().in("id", chapterIds);
  }

  // Team data: scope by sim teams AND by sim users (a sim user may have
  // requested to join / been invited to a team named outside the sim pattern,
  // though in practice all sim teams use "Sim %").
  if (teamIds.length > 0) {
    await db.from("team_join_requests").delete().in("team_id", teamIds);
    await db.from("team_invites").delete().in("team_id", teamIds);
    await db.from("team_members").delete().in("team_id", teamIds);
    await db.from("teams").delete().in("id", teamIds);
  }
  // Invites addressed to sim emails (the invitee may not have a team yet).
  if (profileEmails.length > 0) {
    await db.from("team_invites").delete().in("email", profileEmails);
  }
  await db.from("team_invites").delete().like("email", SIM_EMAIL_PATTERN);
  if (profileIds.length > 0) {
    await db.from("team_join_requests").delete().in("user_id", profileIds);
    await db.from("team_members").delete().in("user_id", profileIds);
  }

  // Verification codes for sim emails.
  await db.from("verification_codes").delete().like("email", SIM_EMAIL_PATTERN);

  // Clear rows that hold a foreign key to the sim profiles, otherwise the
  // profile delete fails (e.g. event_log.actor_id when a sim user created a
  // team, screening_scores.screener_id, participant_flags.created_by, etc.).
  if (profileIds.length > 0) {
    await db.from("event_log").delete().in("actor_id", profileIds);
    await db.from("admin_audit_log").delete().in("performed_by", profileIds);
    await db.from("screening_scores").delete().in("screener_id", profileIds);
    await db.from("participant_flags").delete().in("created_by", profileIds);
    await db.from("participant_flags").delete().in("resolved_by", profileIds);
  }

  // Profiles, then auth users.
  if (profileIds.length > 0) {
    await db.from("profiles").delete().in("id", profileIds);
  }
  for (const id of profileIds) {
    try {
      await db.auth.admin.deleteUser(id);
    } catch {
      // already gone — fine
    }
  }

  // Sweep any orphaned sim auth users (profile gone but auth.users remains).
  try {
    const orphaned: string[] = [];
    let page = 1;
    while (true) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 100 });
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email?.endsWith(`@${SIM_DOMAIN}`)) orphaned.push(u.id);
      }
      if (users.length < 100) break;
      page++;
    }
    for (const id of orphaned) {
      try {
        await db.auth.admin.deleteUser(id);
      } catch {
        // ignore
      }
    }
  } catch {
    // listUsers may be unavailable in some environments
  }
}
