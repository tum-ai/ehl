/**
 * Seed the EPHEMERAL LOCAL Supabase stack (the one started by `supabase start`
 * in CI, or locally for development).
 *
 * This is the local-stack counterpart of scripts/seed-test-via-api.ts. The API
 * script talks to the REMOTE test project over the Management API; this one runs
 * the exact same privileged SQL against the LOCAL Postgres via `psql` (which is
 * preinstalled on the GitHub `ubuntu-latest` runner and ships with the Supabase
 * CLI's local dev workflow). No Management-API token / project ref needed.
 *
 * What it does (mirrors seed-test-via-api.ts):
 *   1. Create the fixed-UUID seed auth.users (profiles FK to auth.users).
 *   2. Clear event_log (append-only trigger disabled around the wipe).
 *   3. Run supabase/seed.sql with the profiles role triggers disabled (the seed
 *      inserts admin/jury/chapter_admin profiles, which prevent_role_on_insert
 *      blocks for non-service_role callers; psql connects as postgres with no
 *      request.jwt.claims, so the trigger must be disabled around the seed).
 *
 * Usage (after `supabase start`):
 *   pnpm exec tsx scripts/seed-local.ts
 *
 * Safety: refuses to run unless the configured Supabase URL is a LOCAL address
 * (127.0.0.1 / localhost). This guarantees it can never touch a remote project.
 * The Postgres connection string is read from `supabase status` (the local
 * stack), never from a remote source.
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Hard safety gate: only ever run against a local stack.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL)) {
  console.error(
    `REFUSING: NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL || "<unset>"}) is not a ` +
      "local address. scripts/seed-local.ts only seeds the local `supabase start` stack."
  );
  process.exit(1);
}

const PROJECT_ROOT = resolve(__dirname, "..");
const SEED_PATH = resolve(PROJECT_ROOT, "supabase/seed.sql");

/** Read the local Postgres connection string from `supabase status -o env`. */
function getLocalDbUrl(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  const m = out.match(/^DB_URL="?([^"\n]+)"?$/m);
  if (!m) {
    throw new Error("Could not read DB_URL from `supabase status`. Is the stack running?");
  }
  const dbUrl = m[1];
  if (!/@(127\.0\.0\.1|localhost):/.test(dbUrl)) {
    throw new Error(`REFUSING: DB_URL (${dbUrl}) is not a local connection.`);
  }
  return dbUrl;
}

const DB_URL = getLocalDbUrl();

// Parse the fixed-UUID seed users directly out of seed.sql's profiles inserts
// (id, name, email) so this never drifts from the seed file. Same regex as
// seed-test-via-api.ts.
function parseSeedUsers(): { id: string; email: string; name: string }[] {
  const seed = readFileSync(SEED_PATH, "utf-8");
  const re =
    /'([abc]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',\s*'([^']*)',\s*'([^']*@(?:example|partner)\.com)'/g;
  const seen = new Map<string, { id: string; email: string; name: string }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(seed)) !== null) {
    const id = m[1].trim();
    if (!/^[abc]0000000-/.test(id)) continue; // profiles use a/b/c-prefixed UUIDs
    if (!seen.has(id)) seen.set(id, { id, name: m[2], email: m[3] });
  }
  return [...seen.values()];
}

/**
 * Execute a block of SQL against the LOCAL database via psql. psql uses the
 * simple query protocol, so multi-statement scripts (and seed.sql's BEGIN/COMMIT
 * blocks) run fine — unlike `supabase db query`, which prepares a single
 * statement. -v ON_ERROR_STOP=1 makes any SQL error fail the process.
 */
function runSql(sql: string, label: string) {
  try {
    execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
      cwd: PROJECT_ROOT,
      input: sql,
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch (err) {
    throw new Error(`SQL failed (${label})`, { cause: err });
  }
}

function ensureSeedUserSql(u: { id: string; email: string; name: string }): string {
  // Insert directly into auth.users with the fixed UUID (idempotent). Drop any
  // stale row owning this email under a DIFFERENT id first (collision on the
  // auth email unique index). profiles.id references auth.users on delete
  // cascade, so any dependent profile is cleaned up with it.
  const meta = JSON.stringify({ name: u.name }).replace(/'/g, "''");
  return `
    DELETE FROM auth.users WHERE email = '${u.email}' AND id <> '${u.id}';
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data)
    VALUES ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${u.email}', '', now(), now(), now(), '', '', '', '',
      '{"provider":"email","providers":["email"]}', '${meta}')
    ON CONFLICT (id) DO NOTHING;`;
}

function main() {
  const seedUsers = parseSeedUsers();
  console.log(`Seeding LOCAL DB ${SUPABASE_URL} via psql...`);

  console.log(`Creating ${seedUsers.length} fixed-UUID seed auth users...`);
  runSql(seedUsers.map(ensureSeedUserSql).join("\n"), "auth users");

  // seed.sql wipes profiles; clear event_log first (it FKs to profiles).
  // event_log is append-only via a trigger, so disable it for the wipe.
  console.log("Clearing event_log (append-only trigger disabled temporarily)...");
  runSql(
    "ALTER TABLE event_log DISABLE TRIGGER USER; DELETE FROM event_log; ALTER TABLE event_log ENABLE TRIGGER USER;",
    "event_log"
  );

  console.log("Running supabase/seed.sql (profiles role triggers disabled)...");
  const seedSql = readFileSync(SEED_PATH, "utf-8");
  runSql(
    `ALTER TABLE profiles DISABLE TRIGGER USER;\n${seedSql}\nALTER TABLE profiles ENABLE TRIGGER USER;`,
    "seed.sql"
  );

  console.log("Done. Local stack seeded.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
