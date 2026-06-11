/**
 * Seed the TEST Supabase via the Management API + Admin API.
 *
 * The normal `pnpm test:setup-db` connects to Postgres directly
 * (db.<ref>.supabase.co:5432), which is not reachable from every network.
 * This script does the same job over HTTPS instead:
 *   1. Create the fixed-UUID seed auth.users (profiles FK to auth.users).
 *   2. Run supabase/seed.sql via the Management query API.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.test -- tsx scripts/seed-test-via-api.ts
 *
 * Requires (.env.test): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * and (.env.supabase): SUPABASE_ACCESS_TOKEN, SUPABASE_TEST_REF
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: ".env.supabase" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const TEST_REF = process.env.SUPABASE_TEST_REF!;

if (!ACCESS_TOKEN || !TEST_REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_TEST_REF (from .env.supabase)");
  process.exit(1);
}

// Safety: this script wipes and reseeds the database, so refuse to run unless
// the target URL is the configured TEST project. SUPABASE_TEST_REF comes from
// .env.supabase (gitignored) — no project ref is hardcoded here.
if (!SUPABASE_URL.includes(TEST_REF)) {
  console.error(
    "REFUSING: NEXT_PUBLIC_SUPABASE_URL does not match SUPABASE_TEST_REF. " +
      "This script only runs against the test instance."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Parse the fixed-UUID seed users directly out of seed.sql's profiles inserts
// (id, name, email) so this never drifts from the seed file.
function parseSeedUsers(): { id: string; email: string; name: string }[] {
  const seed = readFileSync(resolve(__dirname, "../supabase/seed.sql"), "utf-8");
  const re = /'([ab c]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',\s*'([^']*)',\s*'([^']*@example\.com)'/g;
  const seen = new Map<string, { id: string; email: string; name: string }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(seed)) !== null) {
    const id = m[1].trim();
    // profiles use a/b/c-prefixed UUIDs; ignore other matches (teams use d...)
    if (!/^[abc]0000000-/.test(id)) continue;
    if (!seen.has(id)) seen.set(id, { id, name: m[2], email: m[3] });
  }
  return [...seen.values()];
}

const SEED_USERS = parseSeedUsers();

async function ensureSeedUser(u: { id: string; email: string; name: string }) {
  // createUser doesn't let us choose the id, so insert directly via SQL into
  // auth.users with the fixed UUID (idempotent).
  const sql = `
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data)
    VALUES ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${u.email}', '', now(), now(), now(), '', '', '', '',
      '{"provider":"email","providers":["email"]}', '${JSON.stringify({ name: u.name }).replace(/'/g, "''")}')
    ON CONFLICT (id) DO NOTHING;`;
  await runSql(sql, `auth user ${u.email}`);
}

async function runSql(query: string, label: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const body = await res.text();
  if (!res.ok || body.includes('"message"')) {
    throw new Error(`SQL failed (${label}): ${body.slice(0, 300)}`);
  }
}

async function main() {
  console.log(`Seeding TEST DB ${SUPABASE_URL} via API...`);

  console.log(`Creating ${SEED_USERS.length} fixed-UUID seed auth users...`);
  for (const u of SEED_USERS) {
    await ensureSeedUser(u);
  }

  // seed.sql wipes profiles; clear event_log first (it FKs to profiles).
  // event_log is append-only via a trigger, so disable it for the wipe — this
  // is the TEST database only.
  console.log("Clearing event_log (append-only trigger disabled temporarily)...");
  await runSql(
    "ALTER TABLE event_log DISABLE TRIGGER USER; DELETE FROM event_log; ALTER TABLE event_log ENABLE TRIGGER USER;",
    "event_log"
  );

  console.log("Running supabase/seed.sql...");
  const seedSql = readFileSync(resolve(__dirname, "../supabase/seed.sql"), "utf-8");
  // The seed inserts admin/jury profiles, which the prevent_role_on_insert and
  // prevent_role_change triggers block for non-service_role callers. The
  // Management API runs as postgres, so disable those triggers around the seed
  // (test DB only; production seeding is done by the app via service_role).
  await runSql(
    `ALTER TABLE profiles DISABLE TRIGGER USER;\n${seedSql}\nALTER TABLE profiles ENABLE TRIGGER USER;`,
    "seed.sql"
  );

  // Sanity check
  const { data: chapters } = await admin.from("chapters").select("slug").order("match_number");
  console.log("Chapters now in test DB:", (chapters ?? []).map((c) => c.slug).join(", "));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
