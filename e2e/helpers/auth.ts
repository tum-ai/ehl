import { type Page } from "@playwright/test";
import { generateMagicLink } from "./data-factory";

export const TEST_PASSWORD = "TestPass123!";

// ─── Test Account Emails ────────────────────────────────────

export const E2E_ACCOUNTS = {
  admin: {
    email: "e2e-admin@test-ehl.com",
    name: "E2E Admin",
  },
  president: {
    email: "e2e-president@test-ehl.com",
    name: "E2E President",
  },
  member: {
    email: "e2e-member1@test-ehl.com",
    name: "E2E Member One",
  },
  solo: {
    email: "e2e-solo@test-ehl.com",
    name: "E2E Solo User",
  },
  jury1: {
    email: "e2e-jury1@test-ehl.com",
    name: "E2E Jury Alpha",
  },
  jury2: {
    email: "e2e-jury2@test-ehl.com",
    name: "E2E Jury Beta",
  },
} as const;

// ─── StorageState Paths ─────────────────────────────────────

export const AUTH_DIR = ".auth";

export const STORAGE_STATE = {
  admin: `${AUTH_DIR}/admin.json`,
  president: `${AUTH_DIR}/participant-president.json`,
  member: `${AUTH_DIR}/participant-member.json`,
  solo: `${AUTH_DIR}/participant-solo.json`,
  jury1: `${AUTH_DIR}/jury1.json`,
  jury2: `${AUTH_DIR}/jury2.json`,
} as const;

// ─── Login Functions ────────────────────────────────────────

/**
 * Login as a participant via magic link (same method as admin/jury).
 *
 * Previously this used the /login UI form, but the Turnstile execute()
 * mode + Server Action redirect is unreliable in CI headless browsers
 * (form submit hangs without error or navigation). Magic link bypasses
 * all client-side complexity and is what admin/jury already use.
 *
 * The login form UI itself is covered by smoke tests.
 */
export async function loginAsParticipant(
  page: Page,
  email: string,
  _password: string = TEST_PASSWORD
) {
  const magicLinkUrl = await generateMagicLink(email, "/dashboard");
  await page.goto(magicLinkUrl);
  await page.waitForURL(/\/(dashboard|event)/, { timeout: 15000 });
}

/**
 * Login as admin via magic link shortcut.
 * NOTE: This bypasses Google OAuth. In production, admins use Google OAuth only.
 *
 * IMPORTANT: We use next=/dashboard (NOT next=/admin) because the auth callback
 * checks isAdminEmail() when next=/admin, which requires the ADMIN_EMAIL_DOMAIN.
 * Our test admin uses @test-ehl.com, so we let the callback check the existing
 * profile instead, which finds role='admin' and redirects to /admin.
 */
export async function loginAsAdmin(page: Page, email: string = E2E_ACCOUNTS.admin.email) {
  const magicLinkUrl = await generateMagicLink(email, "/dashboard");
  await page.goto(magicLinkUrl);
  // The callback sees role='admin' on the profile and redirects to /admin
  await page.waitForURL(/\/(admin|dashboard)/, { timeout: 15000 });
  // If we landed on /dashboard, navigate to /admin manually
  if (!page.url().includes("/admin")) {
    await page.goto("/admin");
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

/**
 * Login as jury via magic link.
 * This mirrors the production flow exactly - jury members receive magic links.
 */
export async function loginAsJury(page: Page, email: string) {
  const magicLinkUrl = await generateMagicLink(email, "/jury");
  await page.goto(magicLinkUrl);
  await page.waitForURL(/\/jury/, { timeout: 15000 });
}

/**
 * Re-authenticate if the session has expired (for long test runs).
 * Call this before critical blocks if the test has been running for a while.
 */
export async function refreshAdminSession(page: Page) {
  // Check if we're still authenticated by trying to access admin
  const response = await page.goto("/admin");
  if (response?.url().includes("/admin/login")) {
    // Session expired, re-authenticate
    await loginAsAdmin(page);
  }
}

// ─── Seed Data Constants (for existing smoke tests) ─────────

export const SEED = {
  admin: {
    id: "a0000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
  },
  jury: [
    {
      id: "b0000000-0000-0000-0000-000000000001",
      email: "jury1@example.com",
      name: "Jury Alpha",
    },
    {
      id: "b0000000-0000-0000-0000-000000000002",
      email: "jury2@example.com",
      name: "Jury Beta",
    },
  ],
  teams: {
    alpha: {
      id: "d0000000-0000-0000-0000-000000000001",
      name: "Alpha Innovators",
      slug: "alpha-innovators",
      points: 8,
      bestFinish: 1,
    },
    beta: {
      id: "d0000000-0000-0000-0000-000000000002",
      name: "Beta Hackers",
      slug: "beta-hackers",
      points: 7,
      bestFinish: 2,
    },
    gamma: {
      id: "d0000000-0000-0000-0000-000000000003",
      name: "Gamma Coders",
      slug: "gamma-coders",
      points: 6,
      bestFinish: 3,
    },
    delta: {
      id: "d0000000-0000-0000-0000-000000000004",
      name: "Delta Builders",
      slug: "delta-builders",
      points: 4,
      bestFinish: 4,
    },
    epsilon: {
      id: "d0000000-0000-0000-0000-000000000005",
      name: "Epsilon Devs",
      slug: "epsilon-devs",
      points: 2,
      bestFinish: null,
    },
    zeta: {
      id: "d0000000-0000-0000-0000-000000000006",
      name: "Zeta Tech",
      slug: "zeta-tech",
      points: 2,
      bestFinish: null,
    },
  },
  chapters: {
    munich: {
      id: "e0000000-0000-0000-0000-000000000001",
      slug: "munich-1",
      status: "completed",
    },
    zurich: {
      id: "e0000000-0000-0000-0000-000000000002",
      slug: "zurich-2",
      status: "challenge_selection",
    },
    berlin: {
      id: "e0000000-0000-0000-0000-000000000003",
      slug: "berlin-3",
      status: "draft",
    },
  },
  challenges: {
    aiForGood: {
      id: "f0000000-0000-0000-0000-000000000001",
      title: "AI for Good",
    },
    greenInnovation: {
      id: "f0000000-0000-0000-0000-000000000002",
      title: "Green Innovation",
    },
    smartCity: {
      id: "f0000000-0000-0000-0000-000000000003",
      title: "Smart City",
    },
    healthTech: {
      id: "f0000000-0000-0000-0000-000000000004",
      title: "HealthTech",
    },
  },
} as const;
