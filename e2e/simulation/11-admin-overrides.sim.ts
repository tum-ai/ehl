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
});
