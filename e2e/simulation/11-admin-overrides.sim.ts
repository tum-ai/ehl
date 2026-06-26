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
import {
  adminLoginViaSession,
  adminClient,
  simEmail,
  SIM_RUN,
  SIM_ADMIN_EMAIL,
  createChapterViaUI,
  createChallengeViaUI,
  getChallengeId,
  advanceChapterStatusViaUI,
} from "./sim-helpers";
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE } from "@/lib/config/limits";

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

    // Audit-actor regression (#42): the captain-change event must record WHICH
    // admin made the edit — actor_type "admin" with a NON-NULL actor_id equal to
    // the acting admin's profile id (never an anonymous "who changed this?" row).
    // logEvent is deferred via after(), so poll.
    const { data: adminProfile } = await db
      .from("profiles")
      .select("id")
      .eq("email", SIM_ADMIN_EMAIL)
      .single();
    expect(adminProfile?.id, "sim admin profile resolvable").toBeTruthy();
    await expect
      .poll(async () => {
        const { data } = await db
          .from("event_log")
          .select("actor_id, actor_type")
          .eq("action", "team.captain_changed")
          .eq("entity_id", teamId)
          .order("created_at", { ascending: false })
          .limit(1);
        return data?.[0] ?? null;
      }, { timeout: 15000 })
      .toEqual({ actor_id: adminProfile!.id, actor_type: "admin" });
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
    // Source team needs MIN_TEAM_SIZE+1 members so that moving one out still
    // leaves it valid (>= MIN_TEAM_SIZE). The admin UI hides the move control for
    // a source team that would drop below MIN_TEAM_SIZE (matching the
    // adminMoveMember server guard added in this release), so a 2-member source
    // would correctly show "Cannot move members out..." and have no move select.
    const moverName = `ov-mv-mover-${Date.now()}`;
    const mover = await mkProfile(moverName);
    const extra = await mkProfile(`ov-mv-extra-${Date.now()}`);
    await db.from("team_members").insert([
      { team_id: teamA.id, user_id: mover.id, role: "member" },
      { team_id: teamA.id, user_id: extra.id, role: "member" },
    ]);

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    const rowA = page.locator("tr", { hasText: teamA.name });
    await expect(rowA).toHaveCount(1);
    await rowA.getByRole("button", { name: /^manage$/i }).click();
    await expect(rowA.getByText("Move member to team")).toBeVisible();
    // There is one move <select> per non-captain; target the mover's specifically
    // by anchoring on its name span's following sibling select (member ordering
    // is only by role, so `.last()` could hit the wrong member).
    await rowA
      .locator(
        `xpath=.//span[normalize-space()="${moverName}"]/following-sibling::select[1]`
      )
      .selectOption(teamB.id);
    await page.waitForTimeout(1500);

    const { data: onA } = await db.from("team_members").select("user_id").eq("team_id", teamA.id).eq("user_id", mover.id).maybeSingle();
    const { data: onB } = await db.from("team_members").select("user_id").eq("team_id", teamB.id).eq("user_id", mover.id).maybeSingle();
    expect(onA, "mover removed from source team").toBeNull();
    expect(onB, "mover added to destination team").toBeTruthy();
    // The extra member keeps teamA at MIN_TEAM_SIZE — it must NOT have been moved.
    const { data: extraStillA } = await db.from("team_members").select("user_id").eq("team_id", teamA.id).eq("user_id", extra.id).maybeSingle();
    expect(extraStillA, "non-targeted member stays on source team").toBeTruthy();
  });

  test("move is BLOCKED in the UI when the source team would drop below the minimum", async ({ page }) => {
    // New-this-release guard: a source team at exactly MIN_TEAM_SIZE cannot move
    // a member out (it would leave fewer than MIN_TEAM_SIZE). The UI renders an
    // explanatory message instead of the move control. This locks in the
    // behavior that previously made the move test time out.
    const presA = await mkProfile(`ov-mvblock-presA-${Date.now()}`);
    const presB = await mkProfile(`ov-mvblock-presB-${Date.now()}`);
    const teamA = await mkTeam("mvBlockA", presA.id);
    await mkTeam("mvBlockB", presB.id); // a destination must exist for the control to be considered
    const mover = await mkProfile(`ov-mvblock-mover-${Date.now()}`);
    // teamA = president + one member = MIN_TEAM_SIZE (2). Moving the member out
    // would drop it to 1.
    await db.from("team_members").insert({ team_id: teamA.id, user_id: mover.id, role: "member" });

    await adminLoginViaSession(page);
    await page.goto("/admin/teams", { waitUntil: "networkidle" });
    const rowA = page.locator("tr", { hasText: teamA.name });
    await expect(rowA).toHaveCount(1);
    await rowA.getByRole("button", { name: /^manage$/i }).click();

    await expect(
      rowA.getByText(
        `Cannot move members out: the team must keep at least ${MIN_TEAM_SIZE} members.`
      )
    ).toBeVisible();
    await expect(rowA.getByText("Move member to team")).toHaveCount(0);
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

  test("admin overrides a team's challenge via the real /admin/teams dropdown (#41)", async ({ page }) => {
    test.setTimeout(120_000);
    // Challenge-override (#41): on /admin/teams an admin can assign/change a team's
    // challenge while the chapter is in challenge_selection/hacking/submissions_open
    // and before the submission deadline. The control only renders for the page's
    // ACTIVE chapter (the FIRST chapter, by match_number, in an event status).
    //
    // On the shared test DB other (non-sim) chapters sit in event statuses with
    // low match_numbers we must not touch. To make OUR chapter the active one
    // deterministically we set its match_number to -1 (lower than any real chapter;
    // the column is plain `int not null`, no constraint). Two gotchas, both handled:
    //   - The match_number MUST be set AFTER all chapter/challenge/status UI steps:
    //     createChapterViaUI's details-save runs a GLOBAL recalculateMatchNumbers()
    //     that would clobber an earlier value. Challenge creation + status changes
    //     do not recalc, so setting it last is safe.
    //   - adminSetTeamChallenge requires a team member with an accepted/checked-in
    //     application in the chapter (not just team-in-chapter), so we create one.
    const chapterName = `Sim OV Challenge ${SIM_RUN}-${Date.now()}`;
    let chapterId = "";
    const pres = await mkProfile(`ov-chal-pres-${Date.now()}`);
    const team = await mkTeam("chalOV", pres.id);
    // Defensive: a CRASHED earlier run (before its finally) could leave a stale
    // "Sim OV Challenge" chapter at match_number -1 in an event status, which would
    // tie with ours for "first active chapter". Remove any such leftovers first so
    // our chapter is the unambiguous active one.
    {
      const { data: stale } = await db
        .from("chapters")
        .select("id")
        .like("name", "Sim OV Challenge%");
      for (const c of stale ?? []) {
        await db.from("challenge_registrations").delete().eq("chapter_id", c.id);
        await db.from("applications").delete().eq("chapter_id", c.id);
        const { data: chal } = await db.from("challenges").select("id").eq("chapter_id", c.id);
        for (const ch of chal ?? []) await db.from("challenges").delete().eq("id", ch.id);
        await db.from("chapters").delete().eq("id", c.id);
      }
    }
    try {
      await adminLoginViaSession(page);
      const created = await createChapterViaUI(page, { name: chapterName });
      chapterId = created.id;

      await createChallengeViaUI(page, chapterId, { title: `Sim OV Chal A ${SIM_RUN}` });
      await createChallengeViaUI(page, chapterId, { title: `Sim OV Chal B ${SIM_RUN}` });
      const chalA = await getChallengeId(chapterId, `Sim OV Chal A ${SIM_RUN}`);
      const chalB = await getChallengeId(chapterId, `Sim OV Chal B ${SIM_RUN}`);
      // challenge_selection is an override-open status and only needs >= 1 challenge.
      await advanceChapterStatusViaUI(page, chapterId, "challenge_selection");

      // The president must be an accepted applicant in this chapter, else the
      // override action rejects the team as "not part of this chapter's event".
      await db.from("applications").insert({
        chapter_id: chapterId,
        email: pres.email,
        first_name: "OvChal",
        last_name: "Pres",
        status: "accepted",
      });
      // Team registered on challenge A (the override will move it to B).
      await db.from("challenge_registrations").insert({
        chapter_id: chapterId,
        challenge_id: chalA,
        team_id: team.id,
        roster: [pres.id],
      });

      // Make OUR chapter the active one — LAST, after all UI/recalc, and confirm it
      // actually took AND that it is now the first active chapter the page will use.
      const { error: mnErr } = await db
        .from("chapters")
        .update({ match_number: -1, submission_deadline: null })
        .eq("id", chapterId);
      expect(mnErr, "match_number update succeeded").toBeNull();
      const eventStatuses = ["preparation", "challenge_selection", "hacking", "submissions_open", "pitching"];
      await expect
        .poll(async () => {
          const { data } = await db
            .from("chapters")
            .select("id")
            .in("status", eventStatuses)
            .order("match_number", { ascending: true })
            .limit(1);
          return data?.[0]?.id ?? null;
        }, { timeout: 15000 })
        .toBe(chapterId);

      await page.goto("/admin/teams", { waitUntil: "networkidle" });
      // Our chapter is active, so the Challenge column + override dropdowns render.
      const row = page.locator("tr", { hasText: team.name });
      await expect(row).toHaveCount(1);
      // The override <select> is the only select in the row (the challenge column).
      const challengeSelect = row.locator("select");
      await expect(challengeSelect).toHaveCount(1);
      // advanceChapterStatusViaUI installed a PERSISTENT page.on("dialog") accepter,
      // so the challenge-change confirm() is handled by it. A second page.once here
      // would double-handle the dialog ("Cannot accept dialog which is already
      // handled"), so we do NOT add one.
      await challengeSelect.selectOption(chalB);

      // DB: the registration row now points at challenge B (changed, not duplicated).
      await expect
        .poll(async () => {
          const { data } = await db
            .from("challenge_registrations")
            .select("challenge_id")
            .eq("chapter_id", chapterId)
            .eq("team_id", team.id);
          return { count: data?.length ?? 0, challenge: data?.[0]?.challenge_id ?? null };
        }, { timeout: 15000 })
        .toEqual({ count: 1, challenge: chalB });

      // Audit (#42 + #41): the override is logged as an admin action with a
      // non-null actor_id equal to the acting admin.
      const { data: adminProfile } = await db
        .from("profiles").select("id").eq("email", SIM_ADMIN_EMAIL).single();
      await expect
        .poll(async () => {
          const { data } = await db
            .from("event_log")
            .select("actor_id, actor_type")
            .eq("action", "challenge_registration.admin_override")
            .eq("entity_id", team.id)
            .order("created_at", { ascending: false })
            .limit(1);
          return data?.[0] ?? null;
        }, { timeout: 15000 })
        .toEqual({ actor_id: adminProfile!.id, actor_type: "admin" });
    } finally {
      // Clean up so retries / reruns don't accumulate sim chapters that linger in
      // an event status (they would compete to be the active chapter).
      if (chapterId) {
        await db.from("challenge_registrations").delete().eq("chapter_id", chapterId);
        await db.from("applications").delete().eq("chapter_id", chapterId);
        const { data: chal } = await db.from("challenges").select("id").eq("chapter_id", chapterId);
        for (const c of chal ?? []) await db.from("challenges").delete().eq("id", c.id);
        await db.from("chapters").delete().eq("id", chapterId);
      }
    }
  });
});
