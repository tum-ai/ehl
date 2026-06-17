/**
 * Simulation slice 2: real-UI chapter application with CV upload.
 *
 * Admin creates a chapter through the real admin UI and opens applications via
 * the real status control. A would-be participant then fills the real
 * /apply/<slug> form end to end, uploads a PDF CV (setInputFiles), and submits.
 * We assert the application row lands in the DB. We also assert the UI rejects
 * a non-PDF CV.
 *
 * The apply form has no htmlFor labels: inputs are selected by name/placeholder
 * and the radio/checkbox "chip" groups are clicked by their visible option text.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  advanceChapterStatusViaUI,
  getChapterSlugByName,
  simEmail,
  adminClient,
  clearMailbox,
  cleanupSimData,
} from "./sim-helpers";
import { tinyPdfBuffer } from "./sim-helpers";

const CHAPTER_NAME = "Sim Apply Match";

/**
 * Fill every required field on the real application form. The form must already
 * be showing (for anonymous users, that means the email was entered + blurred).
 */
async function fillApplicationForm(page: Page, opts: { firstName: string; lastName: string }) {
  // Personal Information
  await page.locator('input[name="firstName"]').fill(opts.firstName);
  await page.locator('input[name="lastName"]').fill(opts.lastName);
  await page.locator('input[name="dateOfBirth"]').fill("2000-01-15");
  // Radio chips are <label> wrappers around an sr-only input; click the label text.
  await page.getByText("Male", { exact: true }).click();
  await page.locator('input[name="locationCity"]').fill("Munich");
  await page.locator('input[name="locationCountry"]').fill("Germany");
  await page.locator('input[name="nationality"]').fill("German");

  // Academic: "No longer studying" keeps it short (no university fields).
  await page.getByText("No", { exact: true }).first().click();

  // Skills & Experience: programming yes, tumai no.
  // Two yes/no groups appear here; click within their card scopes.
  await page.getByText("Do you have any programming skills?").locator("xpath=ancestor::div[1]").getByText("Yes", { exact: true }).click();
  await page.getByText("Are you a TUM.ai member?").locator("xpath=ancestor::div[1]").getByText("No", { exact: true }).click();
  await page.locator('textarea[name="hackathonExperience"]').fill("Attended two hackathons previously and enjoy building fast.");

  // Team: No team.
  await page.getByText("Do you already have a team?").locator("xpath=ancestor::div[1]").getByText("No", { exact: true }).click();

  // Logistics
  await page.getByText("None", { exact: true }).click(); // Dietary
  await page.getByText("Men's", { exact: true }).click(); // T-shirt cut
  await page.getByText("M", { exact: true }).click(); // T-shirt size
  await page.getByText("LinkedIn", { exact: true }).click(); // discovery source

  // CV Upload: Yes (so the file input renders).
  await page.getByText("Do you want to upload your CV?").locator("xpath=ancestor::div[1]").getByText("Yes", { exact: true }).click();
}

test.describe("Simulation: application with CV upload (real UI)", () => {
  let slug: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin creates a chapter and opens applications via the real UI", async ({ page }) => {
    await adminLoginViaSession(page);
    const { id } = await createChapterViaUI(page, { name: CHAPTER_NAME });
    await advanceChapterStatusViaUI(page, id, "applications_open");

    // DB confirmation
    const db = adminClient();
    const { data } = await db.from("chapters").select("status, slug").eq("id", id).single();
    expect(data?.status).toBe("applications_open");
    slug = data!.slug as string;
  });

  test("a participant submits an application with a PDF CV through the real apply form", async ({ page }) => {
    if (!slug) slug = await getChapterSlugByName(CHAPTER_NAME);
    const email = simEmail("sim-applicant-1");
    const since = new Date().toISOString();

    await page.goto(`/apply/${slug}`);
    // Anonymous: enter email and blur to reveal the rest of the form.
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="email"]').blur();

    await fillApplicationForm(page, { firstName: "Sim", lastName: "Applicant" });

    // Upload a valid PDF CV.
    await page.locator('input[name="cv"]').setInputFiles({
      name: "cv.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdfBuffer(),
    });

    await page.getByRole("button", { name: /submit application/i }).click();

    // Success screen.
    await expect(page.getByText(/application submitted/i)).toBeVisible({ timeout: 20000 });

    // DB confirmation: the application row exists for this chapter + email.
    const db = adminClient();
    const { data: chapter } = await db.from("chapters").select("id").eq("slug", slug).single();
    const { data: app } = await db
      .from("applications")
      .select("id, email, first_name, status")
      .eq("chapter_id", chapter!.id)
      .eq("email", email)
      .maybeSingle();
    expect(app, "application row should exist").toBeTruthy();
    expect(app!.first_name).toBe("Sim");

    // A confirmation email is sent (deferred). Verify it lands in Mailpit.
    const { waitForEmail } = await import("../helpers/mailpit");
    const mail = await waitForEmail(email, { sinceISO: since, subjectIncludes: "Application received" });
    expect(mail.Subject).toMatch(/application received/i);
  });

  test("the apply form rejects a non-PDF CV through the UI", async ({ page }) => {
    if (!slug) slug = await getChapterSlugByName(CHAPTER_NAME);
    const email = simEmail("sim-applicant-2");

    await page.goto(`/apply/${slug}`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="email"]').blur();

    await fillApplicationForm(page, { firstName: "Sim", lastName: "BadCv" });

    // Upload a non-PDF file (a PNG masquerading as a CV).
    await page.locator('input[name="cv"]').setInputFiles({
      name: "resume.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a real pdf"),
    });

    await page.getByRole("button", { name: /submit application/i }).click();

    // Server rejects: "CV must be a PDF file." surfaces in the error box.
    await expect(page.getByText(/CV must be a PDF file/i)).toBeVisible({ timeout: 20000 });

    // And no application row was created.
    const db = adminClient();
    const { data: chapter } = await db.from("chapters").select("id").eq("slug", slug).single();
    const { data: app } = await db
      .from("applications")
      .select("id")
      .eq("chapter_id", chapter!.id)
      .eq("email", email)
      .maybeSingle();
    expect(app, "rejected application must NOT be persisted").toBeNull();
  });
});
