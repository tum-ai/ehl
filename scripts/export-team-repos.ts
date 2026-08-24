/**
 * Export a CSV of team name -> the team's OWN repository URL.
 *
 * The repo URL lives in `submissions.fields[<key>]`, where `<key>` is the key of
 * a challenge submission field of type "repo". This is the participants' real
 * repository. It is deliberately NOT `submissions.fork_url`, which is EHL's
 * snapshot fork used for jury review.
 *
 * Run: dotenv -e .env.local -- tsx scripts/export-team-repos.ts [chapterSlugOrId] [outFile]
 *      (use .env.test to target the test instance)
 *
 * With no chapter argument every chapter is exported.
 * outFile defaults to ./team-repos[-<chapter>].csv
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import type { SubmissionFieldConfig } from "../lib/types";

export function csvCell(value: string): string {
  // Quote always: team names and project names routinely contain commas/quotes.
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Keys of the submission fields that hold the team's OWN repository URL.
 *
 * A repo field is normally type "repo", but the default challenge config that
 * several challenges still carry declares the repo field as type "url" with key
 * "repo". Match both, or the export silently drops those challenges. Explicit
 * "repo"-typed fields win when present, so a challenge that has both does not
 * also pick up unrelated url fields.
 */
export function repoFieldKeys(fields: SubmissionFieldConfig[]): string[] {
  const explicit = fields.filter((f) => f.type === "repo").map((f) => f.key);
  if (explicit.length > 0) return explicit;
  return fields
    .filter((f) => f.type === "url" && /repo|github|git\b/i.test(`${f.key} ${f.label ?? ""}`))
    .map((f) => f.key);
}

async function main() {
  const chapterArg = process.argv[2];
  const outFile =
    process.argv[3] ||
    (chapterArg ? `team-repos-${chapterArg}.csv` : "team-repos.csv");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Resolve the chapter filter (accepts a slug or a UUID), if given.
  let chapterIds: string[] | null = null;
  if (chapterArg) {
    const { data: chapters, error } = await db
      .from("chapters")
      .select("id, slug, name")
      .or(`slug.eq.${chapterArg},id.eq.${chapterArg}`);
    if (error) {
      console.error("Failed to resolve chapter:", error.message);
      process.exit(1);
    }
    if (!chapters || chapters.length === 0) {
      console.error(`No chapter matches "${chapterArg}"`);
      process.exit(1);
    }
    chapterIds = chapters.map((c) => c.id as string);
    console.log(`Chapter: ${chapters.map((c) => `${c.name} (${c.slug})`).join(", ")}`);
  }

  // Challenges carry the submission-field config that tells us which field is the repo.
  let challengeQuery = db
    .from("challenges")
    .select("id, title, chapter_id, submission_fields");
  if (chapterIds) challengeQuery = challengeQuery.in("chapter_id", chapterIds);
  const { data: challenges, error: challengeError } = await challengeQuery;
  if (challengeError) {
    console.error("Failed to read challenges:", challengeError.message);
    process.exit(1);
  }
  if (!challenges || challenges.length === 0) {
    console.error("No challenges found for that scope.");
    process.exit(1);
  }

  const repoKeysByChallenge = new Map<string, string[]>();
  for (const c of challenges) {
    repoKeysByChallenge.set(
      c.id as string,
      repoFieldKeys((c.submission_fields as SubmissionFieldConfig[] | null) ?? [])
    );
  }

  const { data: subs, error: subError } = await db
    .from("submissions")
    .select("team_id, challenge_id, project_name, fields")
    .in("challenge_id", Array.from(repoKeysByChallenge.keys()));
  if (subError) {
    console.error("Failed to read submissions:", subError.message);
    process.exit(1);
  }
  if (!subs || subs.length === 0) {
    console.error("No submissions found for that scope.");
    process.exit(1);
  }

  // Team names in one batched lookup.
  const teamIds = Array.from(new Set(subs.map((s) => s.team_id as string)));
  const { data: teams, error: teamError } = await db
    .from("teams")
    .select("id, name")
    .in("id", teamIds);
  if (teamError) {
    console.error("Failed to read teams:", teamError.message);
    process.exit(1);
  }
  const teamNames = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  const challengeTitles = new Map(challenges.map((c) => [c.id as string, c.title as string]));

  const rows: string[][] = [];
  const missing: string[] = [];

  for (const sub of subs) {
    const teamName = teamNames.get(sub.team_id as string) ?? (sub.team_id as string);
    const fields = (sub.fields as Record<string, string> | null) ?? {};
    const repoKeys = repoKeysByChallenge.get(sub.challenge_id as string) ?? [];
    const repoUrl = repoKeys.map((k) => fields[k]).find((v) => v && v.trim());

    if (!repoUrl) {
      missing.push(teamName);
      continue;
    }
    rows.push([
      teamName,
      repoUrl.trim(),
      (sub.project_name as string) ?? "",
      challengeTitles.get(sub.challenge_id as string) ?? "",
    ]);
  }

  rows.sort((a, b) => a[0].localeCompare(b[0]));

  const header = ["team_name", "repo_url", "project_name", "challenge"];
  const csv =
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

  const outPath = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv, "utf8");

  console.log(`Wrote ${rows.length} row(s) to ${outPath}`);
  if (missing.length > 0) {
    console.log(`${missing.length} submission(s) had no repo URL: ${missing.join(", ")}`);
  }
}

// Only run when invoked as a script, so tests can import the helpers safely.
if (process.argv[1] && /export-team-repos\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
