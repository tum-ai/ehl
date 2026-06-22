/**
 * Apply migration files to the TEST Supabase over the Management API (HTTPS).
 *
 * `pnpm test:setup-db` / `test:setup-supabase` connect to the direct Postgres
 * host `db.<ref>.supabase.co:5432`, which Supabase now serves over IPv6 only.
 * On an IPv4-only network that host fails to resolve ("could not translate host
 * name"). This script applies migrations over `api.supabase.com` instead — the
 * same HTTPS channel scripts/seed-test-via-api.ts already uses — so it works
 * regardless of IPv6 availability.
 *
 * It applies ONLY the migration files whose names start with the prefixes you
 * pass (the test DB already has the earlier history). Re-running is safe: it
 * tolerates "already exists" / "duplicate" errors.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.test -- tsx scripts/apply-migrations-via-api.ts 00045 00046
 *
 * Requires (.env.test): NEXT_PUBLIC_SUPABASE_URL
 * and (.env.supabase): SUPABASE_ACCESS_TOKEN, SUPABASE_TEST_REF
 */

import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: ".env.supabase" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const TEST_REF = process.env.SUPABASE_TEST_REF!;

if (!ACCESS_TOKEN || !TEST_REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_TEST_REF (from .env.supabase)");
  process.exit(1);
}

// Safety: only ever run against the configured TEST project. SUPABASE_TEST_REF
// comes from .env.supabase (gitignored) — no project ref is hardcoded here.
if (!SUPABASE_URL || !SUPABASE_URL.includes(TEST_REF)) {
  console.error(
    "REFUSING: NEXT_PUBLIC_SUPABASE_URL does not match SUPABASE_TEST_REF. " +
      "This script only runs against the test instance."
  );
  process.exit(1);
}

const prefixes = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (prefixes.length === 0) {
  console.error(
    "Pass at least one migration prefix, e.g.:\n" +
      "  pnpm exec dotenv -e .env.test -- tsx scripts/apply-migrations-via-api.ts 00045 00046"
  );
  process.exit(1);
}

// Re-running a non-idempotent CREATE is fine; these errors mean the object is
// already present, so we log and continue rather than abort.
const IGNORABLE = /already exists|already a member|duplicate key/i;

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
    if (IGNORABLE.test(body)) {
      console.log(`  (already applied: ${label})`);
      return;
    }
    throw new Error(`SQL failed (${label}): ${body.slice(0, 400)}`);
  }
}

async function main() {
  const migrationsDir = resolve(__dirname, "../supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && prefixes.some((p) => f.startsWith(p)))
    .sort();

  if (files.length === 0) {
    console.error(`No migration files match prefixes: ${prefixes.join(", ")}`);
    process.exit(1);
  }

  console.log(`Applying ${files.length} migration(s) to TEST DB ${SUPABASE_URL} via API...`);
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
    console.log(`- ${file}`);
    await runSql(sql, file);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
