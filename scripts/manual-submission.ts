/**
 * Manually create or repair one team's submission (admin recovery path).
 *
 * WHY THIS EXISTS: `submitProject` (lib/actions/submissions.ts) enforces the
 * participant-facing gates — check-in, challenge registration, submission
 * deadline, the `is_locked` flag and the Entire session-history hard gate. When
 * one of those gates rejects a team WRONGLY (e.g. the Entire check not
 * recognizing a valid checkpoint layout), the team is locked out of the UI and
 * the submission has to be written by an operator. This script is that path:
 * it does the same work the action does — upload file fields to Drive, grant
 * link access, upsert the submission row, optionally snapshot the repo into the
 * private jury org — but WITHOUT the gates.
 *
 * It is deliberately NOT a server action and NOT reachable from the app: it
 * needs the service-role key and must only ever run from an operator's machine.
 *
 * Run (PRODUCTION):
 *   pnpm dlx dotenv-cli -e .env.local -- tsx scripts/manual-submission.ts \
 *     --chapter munich \
 *     --team "Team Name" \
 *     --project "Project Name" \
 *     --description "One-liner" \
 *     --field repo_url=https://github.com/owner/repo \
 *     --file pitch_deck=./deck.pdf \
 *     --tech "Next.js,Supabase" \
 *     --snapshot
 *
 * Always run with --dry first: it resolves team/challenge, validates the field
 * keys against the challenge config and prints the exact row it WOULD write,
 * without touching Drive, GitHub or the database.
 *
 * Flags:
 *   --chapter <slug>        chapter to resolve the team's registration in (required
 *                           unless --challenge-id is given)
 *   --team <name> | --team-id <uuid>
 *   --challenge-id <uuid>   override; default: the team's challenge_registrations row
 *   --project <name>        project_name (required for a NEW submission)
 *   --description <text>    short_description
 *   --field key=value       repeatable; text/url/repo field values
 *   --file key=<path>       repeatable; uploaded to Drive, stores the view link
 *   --tech "a,b,c"          tech_stack
 *   --snapshot              fork the repo fields into the snapshot org (fork_url)
 *   --lock                  set is_locked = true (match already-locked peers)
 *   --dry                   resolve + validate + print, change nothing
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SubmissionFieldConfig } from "../lib/types";

// ─── Pure helpers (unit-tested in tests/manual-submission.test.ts) ────────────

export interface ParsedArgs {
  flags: Record<string, string>;
  bools: Set<string>;
  fields: Record<string, string>;
  files: Record<string, string>;
}

const BOOL_FLAGS = new Set(["dry", "snapshot", "lock"]);

/**
 * Parse `--flag value`, `--bool`, and the repeatable `--field k=v` / `--file
 * k=path` pairs. A repeated key wins on its LAST occurrence (so a typo can be
 * corrected by re-passing it) and a pair without "=" is a hard error rather
 * than a silently dropped field.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { flags: {}, bools: new Set(), fields: {}, files: {} };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);

    if (BOOL_FLAGS.has(name)) {
      out.bools.add(name);
      continue;
    }

    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${name}`);

    if (name === "field" || name === "file") {
      const eq = value.indexOf("=");
      if (eq <= 0) {
        throw new Error(`--${name} expects key=value, got: ${value}`);
      }
      const target = name === "field" ? out.fields : out.files;
      target[value.slice(0, eq)] = value.slice(eq + 1);
      continue;
    }

    out.flags[name] = value;
  }

  return out;
}

/**
 * MIME type for an upload, from the file extension. Mirrors the whitelist of
 * app/api/submissions/upload/route.ts: an extension outside it is rejected
 * rather than guessed, so this script cannot put a file into Drive that the
 * participant-facing route would have refused (SVG in particular).
 */
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export function mimeForPath(path: string): string {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) {
    throw new Error(
      `Unsupported file type for ${path}. Allowed: ${Object.keys(MIME_BY_EXT).join(", ")}`
    );
  }
  return mime;
}

export interface FieldValidation {
  unknownKeys: string[];
  missingRequired: string[];
  wrongType: string[];
}

/**
 * Check the supplied keys against the challenge's `submission_fields` config.
 * `existingKeys` are the keys already stored on the submission being repaired,
 * so a partial repair (only re-uploading the deck) does not report the fields
 * it leaves untouched as missing.
 */
export function validateFields(
  config: SubmissionFieldConfig[],
  textKeys: string[],
  fileKeys: string[],
  existingKeys: string[] = []
): FieldValidation {
  const byKey = new Map(config.map((f) => [f.key, f]));
  const supplied = [...textKeys, ...fileKeys];

  const unknownKeys = supplied.filter((k) => !byKey.has(k));

  const present = new Set([...supplied, ...existingKeys]);
  const missingRequired = config
    .filter((f) => f.required && !present.has(f.key))
    .map((f) => f.key);

  // A file-type field must come from --file (it needs a Drive upload) and a
  // non-file field must not: passing a local path as --field would store the
  // path string as the answer and silently lose the artifact.
  const wrongType = [
    ...fileKeys.filter((k) => byKey.get(k) && byKey.get(k)!.type !== "file"),
    ...textKeys.filter((k) => byKey.get(k)?.type === "file"),
  ];

  return { unknownKeys, missingRequired, wrongType };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dry = args.bools.has("dry");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use dotenv -e .env.local).");
  }
  const db = createClient(url!, serviceKey!, { auth: { persistSession: false } });

  // 1. Resolve the team.
  let teamId = args.flags["team-id"];
  let teamName = args.flags.team;
  if (!teamId) {
    if (!teamName) fail("Pass --team <name> or --team-id <uuid>.");
    const { data: teams } = await db
      .from("teams")
      .select("id, name")
      .ilike("name", teamName)
      .limit(5);
    if (!teams || teams.length === 0) fail(`No team named "${teamName}".`);
    if (teams.length > 1) {
      fail(
        `"${teamName}" matches ${teams.length} teams: ${teams
          .map((t) => `${t.name} (${t.id})`)
          .join(", ")}. Use --team-id.`
      );
    }
    teamId = teams[0].id as string;
    teamName = teams[0].name as string;
  } else {
    const { data: team } = await db.from("teams").select("name").eq("id", teamId).single();
    if (!team) fail(`No team with id ${teamId}.`);
    teamName = team.name as string;
  }

  // 2. Resolve the challenge, normally via the team's registration for the
  //    chapter. Registration is what ties a team to a challenge, so deriving it
  //    (instead of taking a challenge id on faith) makes it impossible to file
  //    the submission under a challenge the team never entered.
  let challengeId = args.flags["challenge-id"];
  const chapterSlug = args.flags.chapter;
  if (!challengeId) {
    if (!chapterSlug) fail("Pass --chapter <slug> (or --challenge-id <uuid>).");
    const { data: chapter } = await db
      .from("chapters")
      .select("id, name")
      .eq("slug", chapterSlug)
      .single();
    if (!chapter) fail(`No chapter with slug "${chapterSlug}".`);

    const { data: reg } = await db
      .from("challenge_registrations")
      .select("challenge_id")
      .eq("chapter_id", chapter.id)
      .eq("team_id", teamId)
      .single();
    if (!reg) {
      fail(
        `Team "${teamName}" has no challenge registration in chapter "${chapterSlug}". ` +
          "Register the team first (admin > teams > challenge control), or pass --challenge-id."
      );
    }
    challengeId = reg.challenge_id as string;
  }

  const { data: challenge } = await db
    .from("challenges")
    .select("id, title, chapter_id, submission_fields")
    .eq("id", challengeId)
    .single();
  if (!challenge) fail(`No challenge with id ${challengeId}.`);

  const { data: chapterRow } = await db
    .from("chapters")
    .select("name, slug")
    .eq("id", challenge.chapter_id)
    .single();

  // 3. Validate the supplied field keys against the challenge config.
  const fieldConfig = (challenge.submission_fields as SubmissionFieldConfig[]) ?? [];
  const { data: existing } = await db
    .from("submissions")
    .select("id, project_name, fields, tech_stack, is_locked")
    .eq("challenge_id", challengeId)
    .eq("team_id", teamId)
    .maybeSingle();

  const existingFields = (existing?.fields as Record<string, string>) ?? {};
  const check = validateFields(
    fieldConfig,
    Object.keys(args.fields),
    Object.keys(args.files),
    Object.keys(existingFields)
  );
  if (check.unknownKeys.length) {
    fail(
      `Unknown field key(s): ${check.unknownKeys.join(", ")}. ` +
        `Challenge "${challenge.title}" defines: ${fieldConfig
          .map((f) => `${f.key} (${f.type}${f.required ? ", required" : ""})`)
          .join(", ")}`
    );
  }
  if (check.wrongType.length) {
    fail(
      `Wrong flag for field(s) ${check.wrongType.join(", ")}: ` +
        "file-type fields go through --file <key>=<path>, all others through --field <key>=<value>."
    );
  }
  if (check.missingRequired.length) {
    fail(`Missing required field(s): ${check.missingRequired.join(", ")}`);
  }

  const projectName = args.flags.project ?? (existing?.project_name as string | undefined);
  if (!projectName) fail("Pass --project <name> (no existing submission to inherit it from).");

  // Verify the file paths up front so a bad path fails BEFORE anything is
  // uploaded or written.
  const filePlan: Array<{ key: string; path: string; mime: string; bytes: Buffer }> = [];
  for (const [key, path] of Object.entries(args.files)) {
    const mime = mimeForPath(path);
    const bytes = await readFile(path).catch(() => fail(`Cannot read file: ${path}`));
    if (bytes.length > 20 * 1024 * 1024) fail(`${path} exceeds the 20MB submission file limit.`);
    filePlan.push({ key, path, mime, bytes });
  }

  console.log(`Team:       ${teamName} (${teamId})`);
  console.log(`Chapter:    ${chapterRow?.name ?? challenge.chapter_id}`);
  console.log(`Challenge:  ${challenge.title} (${challengeId})`);
  console.log(`Submission: ${existing ? `UPDATE ${existing.id}` : "CREATE"}`);
  console.log(`Project:    ${projectName}`);
  for (const f of filePlan) {
    console.log(`Upload:     ${f.key} <- ${basename(f.path)} (${f.mime}, ${f.bytes.length} bytes)`);
  }
  for (const [k, v] of Object.entries(args.fields)) console.log(`Field:      ${k} = ${v}`);

  if (dry) {
    console.log("\n--dry: nothing was uploaded or written.\n");
    return;
  }

  // 4. Upload file fields to Drive, mirroring the upload route's folder layout
  //    and its "anyone with the link" grant (the jury previews these inline).
  const fields: Record<string, string> = { ...existingFields, ...args.fields };
  if (filePlan.length > 0) {
    const { uploadFile, makeFileLinkReadable, getViewLink } = await import("../lib/gdrive");
    const folderPath = [
      "Submissions",
      chapterRow?.name ?? "Unknown Chapter",
      teamName ?? "Unknown Team",
    ];
    for (const f of filePlan) {
      const result = await uploadFile(f.bytes, basename(f.path), f.mime, folderPath);
      await makeFileLinkReadable(result.fileId).catch((e) =>
        console.error(`  ! link access grant failed for ${result.fileId}:`, e)
      );
      fields[f.key] = getViewLink(result.fileId);
      console.log(`  uploaded ${f.key}: ${fields[f.key]}`);
    }
  }

  // 5. Upsert the submission (same conflict target as submitProject).
  const techStack = args.flags.tech
    ? args.flags.tech.split(",").map((t) => t.trim()).filter(Boolean)
    : ((existing?.tech_stack as string[]) ?? []);

  const row: Record<string, unknown> = {
    challenge_id: challengeId,
    team_id: teamId,
    project_name: projectName,
    fields,
    tech_stack: techStack,
    updated_at: new Date().toISOString(),
  };
  if (args.flags.description !== undefined) row.short_description = args.flags.description;
  if (args.bools.has("lock")) row.is_locked = true;

  const { error: upsertError } = await db
    .from("submissions")
    .upsert(row, { onConflict: "challenge_id,team_id" });
  if (upsertError) fail(`Upsert failed: ${upsertError.message}`);
  console.log("  submission row written");

  // 6. Optional repo snapshot into the private jury org, the one piece of
  //    submitProject that has no DB representation. Failure here is reported
  //    but not fatal: the submission itself is already saved, and a snapshot
  //    can be retried (or produced by the deadline lock) afterwards.
  if (args.bools.has("snapshot")) {
    const { parseGitHubRepo, snapshotRepo, fetchCheckpointBranchIntoFork } = await import(
      "../lib/github"
    );
    const { makeSnapshotName } = await import("../lib/submissions-lock");

    for (const rf of fieldConfig.filter((f) => f.type === "repo")) {
      const repoUrl = fields[rf.key];
      if (!repoUrl) continue;
      const parsed = parseGitHubRepo(repoUrl);
      if (!parsed) {
        console.error(`  ! ${rf.key} is not a parseable GitHub URL: ${repoUrl}`);
        continue;
      }
      const snapshotName = makeSnapshotName(
        teamName ?? teamId!,
        (chapterRow?.slug as string) ?? challenge.chapter_id
      );
      const result = await snapshotRepo(
        parsed.owner,
        parsed.repo,
        snapshotName,
        `EHL submission snapshot: ${teamName}`
      );
      if ("error" in result) {
        console.error(`  ! snapshot failed for ${repoUrl}: ${result.error}`);
        continue;
      }
      await db
        .from("submissions")
        .update({ fork_url: result.snapshotUrl })
        .eq("challenge_id", challengeId)
        .eq("team_id", teamId);
      console.log(`  snapshot: ${result.snapshotUrl}`);
      await fetchCheckpointBranchIntoFork(parsed.owner, parsed.repo, snapshotName).catch((e) =>
        console.error("  ! checkpoint capture failed:", e)
      );
    }
  }

  console.log("\n✓ Done.\n");
}

// Only run when executed directly, so the pure helpers above can be imported
// by tests without the runner firing.
if (process.argv[1]?.includes("scripts/manual-submission")) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
