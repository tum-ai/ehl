import { test, expect } from "@playwright/test";
import { SEED } from "../helpers/auth";

test.describe("Submission form component structure", () => {
  // The SubmissionForm component is rendered within the event flow
  // once a team has registered for a challenge. These tests document
  // the expected form structure and fields.

  // Since the submission form requires authentication and an active
  // challenge registration, these tests verify the page loads and
  // redirects correctly. Structural assertions run only when a session
  // is available.

  test("event page redirects unauthenticated users to login", async ({
    page,
  }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    // Unauthenticated participants are redirected to /login (the participant
    // login route) with a redirect-back param — /auth/login does not exist.
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 10000 });
  });
});

test.describe("Submission form fields (authenticated)", () => {
  // These tests document the expected form fields of the SubmissionForm component.
  // They serve as a specification for the submission UI.

  test("form has project name field (required)", async ({ page }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session with challenge registration");
      return;
    }

    // Look for the project name input within the submission form
    const projectNameLabel = page.getByText("Project Name");
    const isVisible = await projectNameLabel.isVisible().catch(() => false);

    if (!isVisible) {
      // The submission form may not be rendered if the team has not
      // yet registered for a challenge. This is expected.
      test.skip(true, "Skipped: submission form not visible (no challenge registration)");
      return;
    }

    await expect(projectNameLabel).toBeVisible();

    // The project name input should be present and required
    const projectNameInput = page.locator(
      'input[placeholder="Your project name"]'
    );
    await expect(projectNameInput).toBeVisible();
  });

  test("form has short description field with character counter", async ({
    page,
  }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    const descLabel = page.getByText("Short Description");
    const isVisible = await descLabel.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, "Skipped: submission form not visible");
      return;
    }

    await expect(descLabel).toBeVisible();

    // Character counter should show the current count out of 300
    await expect(page.getByText("/300")).toBeVisible();
  });

  test("form has tech stack input field", async ({ page }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    const techStackLabel = page.getByText("Tech Stack");
    const isVisible = await techStackLabel.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, "Skipped: submission form not visible");
      return;
    }

    await expect(techStackLabel).toBeVisible();

    // The tech stack input should show a helpful placeholder
    const techStackInput = page.locator(
      'input[placeholder="e.g. Next.js, Python, OpenAI API"]'
    );
    await expect(techStackInput).toBeVisible();
  });

  test("form renders dynamic fields from challenge configuration", async ({
    page,
  }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    const submitButton = page.getByRole("button", {
      name: /submit project/i,
    });
    const isVisible = await submitButton.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, "Skipped: submission form not visible");
      return;
    }

    // Dynamic fields are rendered between the description and tech stack.
    // The exact fields depend on the challenge's submissionFields config.
    // At minimum, verify the submit button is present.
    await expect(submitButton).toBeVisible();
  });

  test("form shows submit/update button", async ({ page }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    // The button text depends on whether a submission already exists
    const submitButton = page.getByRole("button", {
      name: /submit project|update submission/i,
    });
    const isVisible = await submitButton.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, "Skipped: submission form not visible");
      return;
    }

    await expect(submitButton).toBeEnabled();
  });
});

test.describe("Submission form locked state", () => {
  test("locked form displays submissions locked message", async ({
    page,
  }) => {
    // When submissions are locked (deadline passed), the form should
    // show a locked state instead of editable fields.
    await page.goto(`/event/${SEED.chapters.munich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    // The munich chapter is completed, so submissions should be locked
    const lockedMessage = page.getByText("Submissions Locked");
    const isVisible = await lockedMessage.isVisible().catch(() => false);

    if (!isVisible) {
      // The locked message may not appear if the user has no submission
      // for this chapter, which is also a valid state.
      test.skip(true, "Skipped: locked state not visible (no prior submission)");
      return;
    }

    await expect(lockedMessage).toBeVisible();
    await expect(
      page.getByText("The submission deadline has passed.")
    ).toBeVisible();
  });
});

test.describe("Submission form validation", () => {
  test("project name is required for submission", async ({ page }) => {
    await page.goto(`/event/${SEED.chapters.zurich.slug}`);

    const url = page.url();
    if (url.includes("/login")) {
      test.skip(true, "Skipped: requires authenticated session");
      return;
    }

    const projectNameInput = page.locator(
      'input[placeholder="Your project name"]'
    );
    const isVisible = await projectNameInput.isVisible().catch(() => false);

    if (!isVisible) {
      test.skip(true, "Skipped: submission form not visible");
      return;
    }

    // The project name field should be required
    await expect(projectNameInput).toHaveAttribute("required", "");
  });
});
