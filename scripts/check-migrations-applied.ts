/**
 * Verify that a Supabase database has every migration applied.
 *
 * Runs each probe in scripts/migration-checks.ts against the target project
 * over the Supabase Management API (the same HTTPS channel db-migrate.sh and
 * apply-migrations-via-api.ts use, so it works on IPv4-only networks). For each
 * migration it reports whether the schema artifact that migration introduces is
 * present. Exits 1 if ANY migration is missing, or if the manifest is out of
 * sync with supabase/migrations/.
 *
 * Defaults to the PRODUCTION project. This is the intended use: catch the case
 * where code shipped (a PR merged, an action deployed) but its migration never
 * reached prod — which silently breaks features in production.
 *
 * Usage (from .env.supabase: SUPABASE_ACCESS_TOKEN, SUPABASE_PROD_REF, SUPABASE_TEST_REF):
 *   pnpm db:check                 # production (default)
 *   pnpm db:check --test          # test instance
 *   pnpm db:check --ref <ref>     # an explicit project ref
 *
 * Read-only: every probe is a SELECT against the catalog. Nothing is written.
 */

import { readdirSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { MIGRATION_CHECKS, findManifestProblems } from "./migration-checks";

config({ path: ".env.supabase" });

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROD_REF = process.env.SUPABASE_PROD_REF;
const TEST_REF = process.env.SUPABASE_TEST_REF;

if (!ACCESS_TOKEN) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (from .env.supabase)");
  process.exit(1);
}

// Resolve target project ref from flags.
const argv = process.argv.slice(2);
const refFlagIndex = argv.indexOf("--ref");
const explicitRef = refFlagIndex >= 0 ? argv[refFlagIndex + 1] : undefined;

// `--ref` was passed but with no (or empty) value: error rather than silently
// falling back to PRODUCTION — that fallback would be a surprising footgun.
if (refFlagIndex >= 0 && !explicitRef) {
  console.error("--ref requires a project ref, e.g. --ref wbplmgiykuxzfkqxczzf");
  process.exit(1);
}

const useTest = argv.includes("--test");

let ref: string | undefined;
let targetName: string;
if (explicitRef) {
  ref = explicitRef;
  targetName = `ref ${ref}`;
} else if (useTest) {
  ref = TEST_REF;
  targetName = "TEST";
} else {
  ref = PROD_REF;
  targetName = "PRODUCTION";
}

if (!ref) {
  console.error(
    `Could not resolve target project ref for ${targetName}. ` +
      "Set SUPABASE_PROD_REF / SUPABASE_TEST_REF in .env.supabase, or pass --ref <ref>."
  );
  process.exit(1);
}

/** Run a read-only SELECT and return its first row, via the Management API. */
async function runQuery(query: string): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  // The Management API can return HTTP 200 with an error object
  // (e.g. {"message": "..."}) instead of a row array. Treat that as an error so
  // it surfaces as [ERROR], not a silent [MISSING]. (apply-migrations-via-api.ts
  // guards the same way.)
  if (!Array.isArray(parsed)) {
    throw new Error(`unexpected response: ${text.slice(0, 300)}`);
  }
  return parsed[0] as Record<string, unknown> | undefined;
}

/** Migration file prefixes on disk. */
function migrationFilePrefixes(): string[] {
  const dir = resolve(__dirname, "../supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, 5))
    .sort();
}

async function main() {
  console.log(`Checking migrations against ${targetName} (${ref})...\n`);

  const manifestErrors = findManifestProblems(migrationFilePrefixes());
  if (manifestErrors.length > 0) {
    console.error("Manifest is out of sync with supabase/migrations/:");
    for (const e of manifestErrors) console.error(`  - ${e}`);
    console.error("");
    process.exit(1);
  }

  let missing = 0;
  let errored = 0;
  let unverifiable = 0;

  for (const check of MIGRATION_CHECKS) {
    // Migrations with no independently observable artifact (reverted/absorbed by
    // a later migration, or a defensive no-op). Reported, never failed on.
    if (check.unverifiable) {
      const via = check.unverifiable.coveredBy ? `, net state via ${check.unverifiable.coveredBy}` : "";
      console.log(`  [UNVERIFIABLE] ${check.prefix} ${check.label} (${check.unverifiable.reason}${via})`);
      unverifiable++;
      continue;
    }

    let present: boolean | undefined;
    let err: string | undefined;
    try {
      const row = await runQuery(check.sql!);
      present = row?.present === true;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }

    if (err) {
      console.log(`  [ERROR] ${check.prefix} ${check.label}: ${err}`);
      errored++;
    } else if (present) {
      console.log(`  [OK]    ${check.prefix} ${check.label}`);
    } else {
      console.log(`  [MISSING] ${check.prefix} ${check.label}`);
      missing++;
    }
  }

  const probed = MIGRATION_CHECKS.length - unverifiable;
  console.log("");
  if (missing === 0 && errored === 0) {
    console.log(
      `All ${probed} probed migrations are applied to ${targetName}` +
        (unverifiable > 0 ? ` (${unverifiable} unverifiable, see notes above).` : ".")
    );
    process.exit(0);
  }
  console.error(
    `${missing} missing, ${errored} errored out of ${probed} probed on ${targetName}.`
  );
  if (missing > 0) {
    console.error(
      "Apply the missing migrations with scripts/db-migrate.sh (runs on Prod + Test)."
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
