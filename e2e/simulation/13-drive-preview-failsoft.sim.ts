/**
 * Simulation slice 13: Drive slidedeck preview fail-soft (#33).
 *
 * Regression for #33: a submission's pitch-deck Drive file gets "anyone with the
 * link" access best-effort at upload time; when that grant silently failed, the
 * embedded Drive /preview iframe showed "you need access" until a manual reload.
 * The fix self-heals at VIEW time via ensureFileLinkReadable(), which NEVER
 * throws — so even when Drive is unavailable the page must still render with the
 * "Open in new tab" fallback instead of 500ing.
 *
 * This sim drives the REAL admin submission detail page against the test harness,
 * which intentionally has NO Google Drive configured (so ensureFileLinkReadable
 * exercises its fail-soft path — the exact condition the bug regressed on). It
 * proves the page survives that condition and shows the usable fallback. The
 * happy-path (a real Drive file actually rendering in the Google iframe) is out
 * of scope for the harness and is covered by the ensureFileLinkReadable unit
 * tests + manual verification against real Drive.
 *
 * Drive network requests are aborted so the fake embed URL can never make the
 * test hang or flake on Google.
 */
import { test, expect } from "@playwright/test";
import {
  adminLoginViaSession,
  createChapterViaUI,
  adminClient,
  cleanupSimData,
  SIM_RUN,
} from "./sim-helpers";

const CHAPTER_NAME = "Sim Drive Match";
// A syntactically valid Drive file URL. The file need not exist: the harness has
// no Drive, so ensureFileLinkReadable() fails soft and the page renders the
// fallback. extractDriveFileId/getDriveEmbedUrl only parse the URL shape.
const DECK_FILE_ID = "SIMfakeDeckFileId0000000000";
const DECK_URL = `https://drive.google.com/file/d/${DECK_FILE_ID}/view`;
const EXPECTED_EMBED = `https://drive.google.com/file/d/${DECK_FILE_ID}/preview`;

test.describe("Simulation: Drive slidedeck preview fail-soft (real UI) (#33)", () => {
  let submissionId = "";

  test.beforeAll(async () => {
    await cleanupSimData();
  });

  test("admin submission detail renders with the 'Open in new tab' fallback when Drive is unavailable", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const db = adminClient();

    // Build a chapter (real UI) + a challenge with a "file" submission field
    // (the default sim challenge strips file fields down to a single URL field,
    // so we insert a challenge with an explicit deck file field directly).
    await adminLoginViaSession(page);
    const chapter = await createChapterViaUI(page, { name: CHAPTER_NAME });
    // The detail page resolves the challenge via the ANON client, whose RLS only
    // exposes challenges whose chapter is NOT 'draft' (a freshly created chapter
    // is 'draft'). Move it out of draft so getChallengeById() can read it — else
    // the page 404s on the challenge lookup, not the submission. submissions_open
    // is the realistic status for viewing a submitted pitch deck.
    await db.from("chapters").update({ status: "submissions_open" }).eq("id", chapter.id);

    const { data: challenge, error: chErr } = await db
      .from("challenges")
      .insert({
        chapter_id: chapter.id,
        title: `Sim Drive Challenge ${SIM_RUN}`,
        description: "Embeddable-deck regression challenge.",
        submission_fields: [
          { key: "deck", label: "Pitch Deck", type: "file", required: true },
        ],
      })
      .select("id")
      .single();
    expect(chErr, "challenge insert").toBeNull();

    // A team + a submission whose deck field is the Drive URL.
    const { data: team, error: teamErr } = await db
      .from("teams")
      .insert({
        name: `Sim Drive Team ${SIM_RUN}-${Date.now()}`,
        slug: `sim-drive-team-${SIM_RUN}-${Date.now()}`,
      })
      .select("id")
      .single();
    expect(teamErr, "team insert").toBeNull();

    const { data: submission, error: subErr } = await db
      .from("submissions")
      .insert({
        challenge_id: challenge!.id,
        team_id: team!.id,
        project_name: "Sim Drive Project",
        short_description: "A sim project with an embeddable pitch deck.",
        // JSONB, not a string. The deck key matches the challenge's file field.
        fields: { deck: DECK_URL },
        tech_stack: ["Next.js"],
      })
      .select("id")
      .single();
    expect(subErr, "submission insert").toBeNull();
    submissionId = submission!.id as string;

    // Never let the fake Drive embed actually load — that would hang/flake the
    // test on Google. We only care that the page renders the iframe + fallback.
    await page.route("https://drive.google.com/**", (route) => route.abort());

    // Open the real admin submission detail page. The server render calls
    // ensureFileLinkReadable() (no Drive configured ⇒ returns false, never
    // throws); the page must still come back 200, not 500.
    const response = await page.goto(`/admin/submissions/${submissionId}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "page renders (not a 500)").toBe(200);

    // The page rendered its own chrome (proves it did not error out).
    await expect(page.getByRole("link", { name: /back to submissions/i })).toBeVisible({
      timeout: 15000,
    });

    // The embeddable deck field shows the "Open in new tab" fallback pointing at
    // the original Drive URL — the usable path when the preview can't render.
    const fallback = page.getByRole("link", { name: /open in new tab/i });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute("href", DECK_URL);

    // The embed iframe exists and points at the Drive /preview URL (its content
    // is aborted above; we assert the element/wiring, not Google's rendering).
    const iframe = page.locator(`iframe[src="${EXPECTED_EMBED}"]`);
    await expect(iframe).toHaveCount(1);
  });

  test.afterAll(async () => {
    // Remove the directly-inserted submission/team/challenge/chapter (cleanupSimData
    // keys off the "Sim %" namespace, but the submission/team here are tied to the
    // sim chapter/challenge, so a final sweep keeps the shared DB clean).
    await cleanupSimData();
  });
});
