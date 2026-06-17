/**
 * Simulation slice 3: real-UI application screening.
 *
 * Admin opens a chapter for applications (real UI), two applicants apply through
 * the real apply form, then the admin reviews them in the real screening table:
 * accepts one, rejects the other via the per-row action buttons, and advances
 * the chapter to "preparation" through the real status control. We assert the
 * DB reflects each status change.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  advanceChapterStatusViaUI,
  submitApplicationViaUI,
  getChapterIdByName,
  simEmail,
  adminClient,
  clearMailbox,
  cleanupSimData,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Screening Match";
const ACCEPT_EMAIL = simEmail("sim-screen-accept");
const REJECT_EMAIL = simEmail("sim-screen-reject");

test.describe("Simulation: screening (real UI)", () => {
  let chapterId: string;
  let slug: string;

  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("admin opens applications and two applicants apply", async ({ page, browser }) => {
    await adminLoginViaSession(page);
    const created = await createChapterViaUI(page, { name: CHAPTER_NAME });
    chapterId = created.id;
    await advanceChapterStatusViaUI(page, chapterId, "applications_open");

    const db = adminClient();
    const { data } = await db.from("chapters").select("slug").eq("id", chapterId).single();
    slug = data!.slug as string;

    // Applicants apply as ANONYMOUS users (fresh context — the admin session in
    // `page` would otherwise be treated as a logged-in applicant).
    for (const applicant of [
      { email: ACCEPT_EMAIL, firstName: "Accept", lastName: "Candidate" },
      { email: REJECT_EMAIL, firstName: "Reject", lastName: "Candidate" },
    ]) {
      const ctx = await browser.newContext();
      const applicantPage = await ctx.newPage();
      await submitApplicationViaUI(applicantPage, { slug, ...applicant });
      await ctx.close();
    }

    // Both applications should be pending in the DB.
    const { count } = await db
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapterId)
      .in("email", [ACCEPT_EMAIL, REJECT_EMAIL]);
    expect(count).toBe(2);
  });

  test("admin accepts one and rejects one application via the real screening UI", async ({ page }) => {
    if (!chapterId) chapterId = await getChapterIdByName(CHAPTER_NAME);
    await adminLoginViaSession(page);
    page.on("dialog", (d) => d.accept());

    await page.goto(`/admin/chapters/${chapterId}/applications`);
    // Wait for the table to render both applicants.
    await expect(page.getByText("Accept Candidate")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Reject Candidate")).toBeVisible();

    // The accept candidate's row has an "Accept" action button.
    const acceptRow = page.locator("tr", { hasText: "Accept Candidate" });
    await acceptRow.getByRole("button", { name: /^accept$/i }).click();
    // The reject candidate's row has a "Reject" action button.
    const rejectRow = page.locator("tr", { hasText: "Reject Candidate" });
    await rejectRow.getByRole("button", { name: /^reject$/i }).click();

    // DB confirmation of the status changes.
    const db = adminClient();
    await expect
      .poll(async () => {
        const { data } = await db
          .from("applications")
          .select("email, status")
          .eq("chapter_id", chapterId)
          .in("email", [ACCEPT_EMAIL, REJECT_EMAIL]);
        const map = Object.fromEntries((data ?? []).map((a) => [a.email, a.status]));
        return `${map[ACCEPT_EMAIL]}/${map[REJECT_EMAIL]}`;
      }, { timeout: 15000 })
      .toBe("accepted/rejected");
  });

  test("admin advances the chapter to preparation via the real status control", async ({ page }) => {
    if (!chapterId) chapterId = await getChapterIdByName(CHAPTER_NAME);
    await adminLoginViaSession(page);
    await advanceChapterStatusViaUI(page, chapterId, "preparation", { from: "applications_open" });

    const db = adminClient();
    const { data } = await db.from("chapters").select("status").eq("id", chapterId).single();
    expect(data?.status).toBe("preparation");
  });
});
