/**
 * Admin override actions through the real admin UI (audit-logged):
 *  - change team captain (syncs teams.president_user_id + team_members.role)
 *  - add a member by email (enforces MAX_TEAM_SIZE)
 *  - change a participant's email (auth + profile)
 *
 * Teams/members are seeded via the admin client (no UI exists for raw team
 * construction); every OVERRIDE is then driven through the real /admin/teams UI.
 */
import { test, expect } from "@playwright/test";
import { adminLoginViaSession, adminClient, simEmail, SIM_RUN } from "./sim-helpers";
import { MAX_TEAM_SIZE } from "@/lib/config/limits";

const db = adminClient();

async function mkProfile(local: string) {
  const email = simEmail(local);
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: "SimPass123!",
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await db.from("profiles").upsert({ id: data.user.id, email, name: local, role: "participant" });
  return { id: data.user.id, email };
}

// Returns { id, name } where name is GLOBALLY UNIQUE so the admin table row can
// be located unambiguously (the test DB accumulates Sim teams across runs).
async function mkTeam(tag: string, presidentId: string) {
  const name = `Sim OV ${tag} ${SIM_RUN}-${Date.now()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { data, error } = await db
    .from("teams")
    .insert({ name, slug, president_user_id: presidentId })
    .select("id")
    .single();
  if (error) throw new Error(`mkTeam: ${error.message}`);
  await db.from("team_members").insert({ team_id: data.id, user_id: presidentId, role: "president" });
  return { id: data.id as string, name };
}

test.describe("Simulation: admin team overrides (real UI)", () => {
  test("change captain promotes a member and demotes the old captain (UI)", async ({ page }) => {
    const pres = await mkProfile(`ov-pres-${Date.now()}`);
    const member = await mkProfile(`ov-mem-${Date.now()}`);
    const team = await mkTeam("cap", pres.id);
    const teamId = team.id;
    await db.from("team_members").insert({ team_id: teamId, user_id: member.id, role: "member" });

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    // Locate THIS team's row by its globally-unique name, open Manage, pick the
    // member as captain (the captain <select> is the first select in the panel).
    const row = page.locator("tr", { hasText: team.name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^manage$/i }).click();
    page.once("dialog", (d) => d.accept()); // confirm() on captain change
    await row.locator("select").first().selectOption(member.id);
    await page.waitForTimeout(1500);

    // DB: captain swapped on BOTH sources of truth.
    const { data: teamRow } = await db.from("teams").select("president_user_id").eq("id", teamId).single();
    expect(teamRow!.president_user_id).toBe(member.id);
    const { data: roles } = await db.from("team_members").select("user_id, role").eq("team_id", teamId);
    expect(roles!.find((r) => r.user_id === member.id)!.role).toBe("president");
    expect(roles!.find((r) => r.user_id === pres.id)!.role).toBe("member");
  });

  test("add member by email enforces the team-size limit", async ({ page }) => {
    const pres = await mkProfile(`ov-full-pres-${Date.now()}`);
    const team = await mkTeam("full", pres.id);
    const teamId = team.id;
    // Fill the team to MAX_TEAM_SIZE.
    for (let i = 1; i < MAX_TEAM_SIZE; i++) {
      const m = await mkProfile(`ov-full-m${i}-${Date.now()}`);
      await db.from("team_members").insert({ team_id: teamId, user_id: m.id, role: "member" });
    }
    const overflow = await mkProfile(`ov-overflow-${Date.now()}`);

    // The guardrail is exercised through the real UI (the action needs an admin
    // session). Adding past the cap must be rejected.
    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    const row = page.locator("tr", { hasText: team.name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^manage$/i }).click();
    page.once("dialog", (d) => d.accept()); // capture the "Team is full" alert
    await row.locator('input[type="email"]').fill(overflow.email);
    await row.getByRole("button", { name: /^add$/i }).click();
    await page.waitForTimeout(1500);

    // DB: the overflow member was NOT added (still MAX_TEAM_SIZE).
    const { count } = await db
      .from("team_members")
      .select("user_id", { count: "exact", head: true })
      .eq("team_id", teamId);
    expect(count).toBe(MAX_TEAM_SIZE);
  });

  test("add member by email adds an existing user (happy path)", async ({ page }) => {
    const pres = await mkProfile(`ov-add-pres-${Date.now()}`);
    const team = await mkTeam("add", pres.id);
    const newcomer = await mkProfile(`ov-add-new-${Date.now()}`);

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    const row = page.locator("tr", { hasText: team.name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^manage$/i }).click();
    await row.locator('input[type="email"]').fill(newcomer.email);
    await row.getByRole("button", { name: /^add$/i }).click();
    await page.waitForTimeout(1500);

    const { data: m } = await db
      .from("team_members")
      .select("user_id, role")
      .eq("team_id", team.id)
      .eq("user_id", newcomer.id)
      .maybeSingle();
    expect(m, "newcomer added to team").toBeTruthy();
    expect(m!.role).toBe("member");
  });

  test("move member relocates them to another team (UI)", async ({ page }) => {
    const presA = await mkProfile(`ov-mv-presA-${Date.now()}`);
    const presB = await mkProfile(`ov-mv-presB-${Date.now()}`);
    const teamA = await mkTeam("mvA", presA.id);
    const teamB = await mkTeam("mvB", presB.id);
    const mover = await mkProfile(`ov-mv-mover-${Date.now()}`);
    await db.from("team_members").insert({ team_id: teamA.id, user_id: mover.id, role: "member" });

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    const rowA = page.locator("tr", { hasText: teamA.name });
    await expect(rowA).toHaveCount(1);
    await rowA.getByRole("button", { name: /^manage$/i }).click();
    // The "move member to team" select for the non-captain mover -> teamB.
    await rowA.getByText("Move member to team").waitFor();
    await rowA.locator("select").last().selectOption(teamB.id);
    await page.waitForTimeout(1500);

    const { data: onA } = await db.from("team_members").select("user_id").eq("team_id", teamA.id).eq("user_id", mover.id).maybeSingle();
    const { data: onB } = await db.from("team_members").select("user_id").eq("team_id", teamB.id).eq("user_id", mover.id).maybeSingle();
    expect(onA, "mover removed from source team").toBeNull();
    expect(onB, "mover added to destination team").toBeTruthy();
  });

  test("change email updates auth + profile (UI)", async ({ page }) => {
    const user = await mkProfile(`ov-email-${Date.now()}`);
    const newEmail = simEmail(`ov-email-new-${Date.now()}`);

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    // Switch to the Participants view and find this user's row.
    await page.getByRole("button", { name: /^participants$/i }).click();
    const row = page.locator("tr", { hasText: user.email });
    await expect(row).toHaveCount(1);
    row.getByRole("button", { name: /^edit$/i }).click();
    page.once("dialog", (d) => d.accept()); // confirm() on email change
    await row.locator('input[type="email"]').fill(newEmail);
    await row.getByRole("button", { name: /^save$/i }).click();
    await page.waitForTimeout(2000);

    // DB: profile email updated.
    const { data: prof } = await db.from("profiles").select("email").eq("id", user.id).single();
    expect(prof!.email).toBe(newEmail);
    // auth.users email updated too (login source of truth).
    const { data: authUser } = await db.auth.admin.getUserById(user.id);
    expect(authUser.user?.email).toBe(newEmail);
  });
});
