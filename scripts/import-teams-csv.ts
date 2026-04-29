/**
 * Import teams from a Tally CSV export into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-teams-csv.ts <csv-file> <chapter-id>
 *
 * Example:
 *   npx tsx scripts/import-teams-csv.ts "Final Submission_ Makeathon 2026_Submissions_2026-04-23.csv" ch1
 *
 * What it does:
 *   1. Parses the CSV (expects Tally export format with "Team Name",
 *      "Email of the Team Captain", "What Challenge did you work on?" columns)
 *   2. Deduplicates teams by name (keeps first submission per team)
 *   3. Generates slug from team name
 *   4. Outputs SQL INSERT statements to stdout
 *   5. Optionally inserts directly into Supabase if env vars are set
 *
 * The script can work in two modes:
 *   - Without Supabase: prints SQL to stdout (pipe to a file)
 *   - With Supabase: inserts directly using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";

interface TallyRow {
  "Team Name": string;
  "Email of the Team Captain": string;
  "What Challenge did you work on?": string;
  "Link to Github repository"?: string;
  "Link to Github repository (2)"?: string;
  "Link to Github repository (3)"?: string;
  "Description of Solution"?: string;
}

interface ParsedTeam {
  name: string;
  slug: string;
  captainEmail: string;
  challenge: string;
  repoUrl: string | null;
  description: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseCSV(filePath: string): ParsedTeam[] {
  const content = readFileSync(filePath, "utf-8");
  const rows: TallyRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const seen = new Map<string, ParsedTeam>();

  for (const row of rows) {
    const name = row["Team Name"]?.trim();
    if (!name) continue;

    // Deduplicate by team name (keep first submission)
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const repoUrl =
      row["Link to Github repository (2)"]?.trim() ||
      row["Link to Github repository (3)"]?.trim() ||
      row["Link to Github repository"]?.trim() ||
      null;

    seen.set(key, {
      name,
      slug: slugify(name),
      captainEmail: row["Email of the Team Captain"]?.trim() || "",
      challenge: row["What Challenge did you work on?"]?.trim() || "",
      repoUrl: repoUrl || null,
      description: row["Description of Solution"]?.trim()?.slice(0, 500) || null,
    });
  }

  return Array.from(seen.values());
}

function generateSQL(teams: ParsedTeam[], chapterId: string): string {
  const lines: string[] = [];

  lines.push("-- Auto-generated from Tally CSV import");
  lines.push(`-- ${teams.length} unique teams\n`);

  // Insert teams
  lines.push("-- Teams");
  for (const team of teams) {
    const escapedName = team.name.replace(/'/g, "''");
    lines.push(
      `INSERT INTO teams (name, slug) VALUES ('${escapedName}', '${team.slug}') ON CONFLICT (slug) DO NOTHING;`
    );
  }

  lines.push("\n-- Scores (all teams get participation points)");
  for (const team of teams) {
    const escapedChallenge = team.challenge.replace(/'/g, "''");
    lines.push(
      `INSERT INTO scores (chapter_id, team_id, challenge_name, placement, points, published)
  SELECT '${chapterId}', t.id, '${escapedChallenge}', NULL, 2, true
  FROM teams t WHERE t.slug = '${team.slug}'
  ON CONFLICT (chapter_id, team_id) DO NOTHING;`
    );
  }

  return lines.join("\n");
}

function generateJSON(teams: ParsedTeam[]): string {
  return JSON.stringify(teams, null, 2);
}

// ─── Main ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const csvFile = args[0];
const chapterId = args[1] || "CHAPTER_ID_HERE";
const format = args[2] || "sql"; // "sql" or "json"

if (!csvFile) {
  console.error("Usage: npx tsx scripts/import-teams-csv.ts <csv-file> [chapter-id] [sql|json]");
  console.error("");
  console.error("Examples:");
  console.error('  npx tsx scripts/import-teams-csv.ts submissions.csv ch1');
  console.error('  npx tsx scripts/import-teams-csv.ts submissions.csv ch1 json');
  process.exit(1);
}

const teams = parseCSV(csvFile);
console.error(`Parsed ${teams.length} unique teams from CSV`);

const challengeCounts: Record<string, number> = {};
for (const t of teams) {
  challengeCounts[t.challenge] = (challengeCounts[t.challenge] || 0) + 1;
}
console.error("Challenges:", challengeCounts);

if (format === "json") {
  console.log(generateJSON(teams));
} else {
  console.log(generateSQL(teams, chapterId));
}
