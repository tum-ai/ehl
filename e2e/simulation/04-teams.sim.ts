/**
 * Simulation slice 4: real-UI team formation.
 *
 * Everything is driven through the real participant UI:
 *  - A president registers and creates a team on the dashboard.
 *  - The president invites a member by email; the invite email lands in Mailpit;
 *    the (already-registered) invitee opens the real /invite/<token> page and
 *    accepts. We assert the member row in the DB.
 *  - A solo "looking for team" user requests to join via the dashboard, and the
 *    president approves the request via the real Join Requests UI. We assert the
 *    member row in the DB.
 *
 * Each person uses their own browser context so sessions never cross.
 */
import { test, expect } from "@playwright/test";
import {
  registerSoloViaUI,
  loginViaUI,
  simEmail,
  adminClient,
  clearMailbox,
  cleanupSimData,
  waitForEmail,
  extractLink,
} from "./sim-helpers";

const TEAM_NAME = "Sim Squad";
const PRESIDENT = simEmail("sim-president");
const INVITEE = simEmail("sim-invitee");
const JOINER = simEmail("sim-joiner");

test.describe("Simulation: team formation (real UI)", () => {
  test.beforeAll(async () => {
    await cleanupSimData();
    await clearMailbox();
  });

  test("president registers and creates a team via the dashboard", async ({ page }) => {
    await registerSoloViaUI(page, { name: "Sim President", email: PRESIDENT });

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /create a team/i }).click();
    await page.locator('input[name="teamName"]').fill(TEAM_NAME);
    await page.locator('input[name="university"]').fill("Sim University");
    await page.getByRole("button", { name: /^create team$/i }).click();

    // The page reloads into the team-management view (Team Roster heading).
    await expect(page.getByText(/team roster/i)).toBeVisible({ timeout: 20000 });

    const db = adminClient();
    const { data: team } = await db
      .from("teams")
      .select("id, name, president_user_id")
      .eq("name", TEAM_NAME)
      .maybeSingle();
    expect(team, "team row should exist").toBeTruthy();
  });

  test("president invites a member who accepts via the real invite page", async ({ browser }) => {
    // The invitee must already have an account (logged-in accept flow).
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    await registerSoloViaUI(inviteePage, { name: "Sim Invitee", email: INVITEE });

    // President logs in and sends the invite.
    const presCtx = await browser.newContext();
    const presPage = await presCtx.newPage();
    await loginViaUI(presPage, PRESIDENT);

    const since = new Date().toISOString();
    await presPage.goto("/dashboard");
    await presPage.getByRole("button", { name: /\+ invite member/i }).click();
    await presPage.locator('input[type="email"]').fill(INVITEE);
    await presPage.getByRole("button", { name: /send invite/i }).click();
    // The invite appears in the roster as Pending.
    await expect(presPage.getByText("Pending").first()).toBeVisible({ timeout: 15000 });

    // Invite email arrives; the invitee opens the /invite/<token> link.
    const mail = await waitForEmail(INVITEE, { sinceISO: since, subjectIncludes: `Join ${TEAM_NAME}` });
    const link = extractLink(mail, "/invite/");
    await inviteePage.goto(link);
    await inviteePage.getByRole("button", { name: new RegExp(`^Join ${TEAM_NAME}$`, "i") }).click();
    await inviteePage.waitForURL(/\/dashboard/, { timeout: 20000 });

    // DB: the invitee is now a member of the team.
    const db = adminClient();
    const { data: team } = await db.from("teams").select("id").eq("name", TEAM_NAME).single();
    const { data: invitee } = await db.from("profiles").select("id").eq("email", INVITEE).single();
    const { data: membership } = await db
      .from("team_members")
      .select("role")
      .eq("team_id", team!.id)
      .eq("user_id", invitee!.id)
      .maybeSingle();
    expect(membership, "invitee should be a team member").toBeTruthy();
    expect(membership!.role).toBe("member");

    await inviteeCtx.close();
    await presCtx.close();
  });

  test("a looking-for-team user requests to join and the president approves", async ({ browser }) => {
    // President enables "Looking for members" so the team is discoverable.
    const presCtx = await browser.newContext();
    const presPage = await presCtx.newPage();
    await loginViaUI(presPage, PRESIDENT);
    await presPage.goto("/dashboard");
    // The "Looking for members" checkbox lives in the roster card. It is a
    // controlled React input toggled via a server action, so we click it (if
    // not already on) and confirm the persisted flag in the DB rather than
    // relying on Playwright's checked-attribute assertion.
    const db = adminClient();
    const { data: teamRow } = await db.from("teams").select("id, looking_for_members").eq("name", TEAM_NAME).single();
    if (!teamRow!.looking_for_members) {
      const lfmCheckbox = presPage
        .locator("label", { hasText: /looking for members/i })
        .locator('input[type="checkbox"]');
      await lfmCheckbox.click();
    }
    await expect
      .poll(async () => {
        const { data } = await db.from("teams").select("looking_for_members").eq("name", TEAM_NAME).single();
        return data?.looking_for_members ?? false;
      }, { timeout: 15000 })
      .toBe(true);

    // Joiner registers as "looking for a team" and requests to join.
    const joinCtx = await browser.newContext();
    const joinPage = await joinCtx.newPage();
    await registerSoloViaUI(joinPage, { name: "Sim Joiner", email: JOINER, lookingForTeam: true });
    await joinPage.goto("/dashboard");
    // The team appears under "Teams Looking for Members"; click "Ask to Join".
    await expect(joinPage.getByText(TEAM_NAME).first()).toBeVisible({ timeout: 15000 });
    await joinPage.getByRole("button", { name: /ask to join/i }).first().click();
    await expect(joinPage.getByText(/^Requested$/i)).toBeVisible({ timeout: 15000 });

    // DB confirms a pending join request exists.
    const { data: team } = await db.from("teams").select("id").eq("name", TEAM_NAME).single();
    const { data: joiner } = await db.from("profiles").select("id").eq("email", JOINER).single();
    await expect
      .poll(async () => {
        const { data } = await db
          .from("team_join_requests")
          .select("status")
          .eq("team_id", team!.id)
          .eq("user_id", joiner!.id)
          .maybeSingle();
        return data?.status ?? null;
      }, { timeout: 15000 })
      .toBe("pending");

    // President approves via the real Join Requests UI.
    presPage.on("dialog", (d) => d.accept());
    await presPage.goto("/dashboard");
    const requestCard = presPage.locator("div", { hasText: "Sim Joiner" }).first();
    await expect(presPage.getByText(/join requests/i)).toBeVisible({ timeout: 15000 });
    await requestCard.getByRole("button", { name: /^accept$/i }).click();

    // DB: joiner is now a member.
    await expect
      .poll(async () => {
        const { data } = await db
          .from("team_members")
          .select("role")
          .eq("team_id", team!.id)
          .eq("user_id", joiner!.id)
          .maybeSingle();
        return data?.role ?? null;
      }, { timeout: 15000 })
      .toBe("member");

    await presCtx.close();
    await joinCtx.close();
  });
});
