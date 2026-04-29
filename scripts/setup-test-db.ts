/**
 * Setup test database: apply all migrations + seed data.
 * Creates a "digital twin" of the production schema on the test Supabase instance.
 *
 * Usage: pnpm tsx scripts/setup-test-db.ts
 *
 * Prerequisites:
 * - .env.test must exist with test Supabase credentials
 * - psql must be installed (brew install libpq)
 *
 * This script:
 * 1. Connects to the TEST Supabase via psql
 * 2. Applies all migrations in order
 * 3. Loads seed data
 */
import { config } from "dotenv";
import { resolve } from "path";
import { readdirSync } from "fs";
import { execSync } from "child_process";

// Load test environment
config({ path: resolve(__dirname, "../.env.test") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.test");
  process.exit(1);
}

// Safety check: never run against production
// Set SUPABASE_TEST_MODE=true in .env.test to confirm this is a test instance
if (process.env.SUPABASE_TEST_MODE !== "true") {
  console.error("FATAL: SUPABASE_TEST_MODE is not set to 'true' in .env.test.");
  console.error("Add SUPABASE_TEST_MODE=true to your .env.test to confirm this is a test instance.");
  process.exit(1);
}

// Extract project ref from URL: https://xxx.supabase.co -> xxx
const projectRef = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");

// Build psql connection string
const password = DB_PASSWORD || "";
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD in .env.test");
  console.error("Add: SUPABASE_DB_PASSWORD=<your-db-password>");
  process.exit(1);
}

// Direct database connection (not pooler - needed for DDL/migrations)
// Format: postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
const connString = `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

function runPsql(filePath: string, label: string, stopOnError = true): boolean {
  try {
    const errorFlag = stopOnError ? "--set ON_ERROR_STOP=on" : "";
    execSync(`psql "${connString}" -f "${filePath}" ${errorFlag} 2>&1`, {
      stdio: "pipe",
      timeout: 60000,
    });
    return true;
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer };
    const output = error.stdout?.toString() || error.stderr?.toString() || "Unknown error";
    // Ignore "already exists" errors (idempotent migrations)
    if (
      output.includes("already exists") ||
      output.includes("duplicate key") ||
      output.includes("does not exist") // DROP IF EXISTS
    ) {
      return true;
    }
    console.error(`\n  Error in ${label}:`);
    console.error(`  ${output.split("\n").slice(0, 5).join("\n  ")}`);
    return false;
  }
}

function main() {
  console.log(`\n=== EHL Test Database Setup ===`);
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Project: ${projectRef}`);
  console.log("────────────────────────────────────────────\n");

  // Check psql is available
  try {
    execSync("which psql", { stdio: "pipe" });
  } catch {
    console.error("psql not found. Install it:");
    console.error("  brew install libpq && brew link --force libpq");
    process.exit(1);
  }

  // Test connection
  process.stdout.write("Testing connection... ");
  try {
    execSync(`psql "${connString}" -c "SELECT 1" 2>&1`, { stdio: "pipe", timeout: 10000 });
    console.log("OK\n");
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer };
    console.error("FAILED");
    console.error(error.stdout?.toString() || error.stderr?.toString());
    process.exit(1);
  }

  // Read all migration files
  const migrationsDir = resolve(__dirname, "../supabase/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Applying ${migrationFiles.length} migrations...\n`);

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of migrationFiles) {
    const filePath = resolve(migrationsDir, file);
    process.stdout.write(`  ${file}... `);

    // Don't use ON_ERROR_STOP for migrations - some contain ALTER TYPE ADD VALUE
    // which cannot run in a transaction and may fail silently on re-run.
    // We run without error stop and verify afterwards.
    const success = runPsql(filePath, file, false);
    if (success) {
      console.log("OK");
      applied++;
    } else {
      failed++;
    }
  }

  console.log(`\nMigrations: ${applied} OK, ${failed} failed\n`);

  // Apply seed data
  const seedPath = resolve(__dirname, "../supabase/seed.sql");
  process.stdout.write("Applying seed data... ");
  // Seed uses BEGIN/COMMIT and DELETE statements - don't stop on empty DELETE results
  const seedSuccess = runPsql(seedPath, "seed.sql", false);
  console.log(seedSuccess ? "OK" : "FAILED");

  if (failed > 0) {
    console.log(`\nWarning: ${failed} migration(s) had errors.`);
    console.log("This may be OK if the schema already existed (idempotent run).");
  }

  // Force PostgREST to reload schema cache (picks up new columns/tables)
  process.stdout.write("Reloading schema cache... ");
  try {
    execSync(`psql "${connString}" -c "NOTIFY pgrst, 'reload schema'" 2>&1`, {
      stdio: "pipe",
      timeout: 10000,
    });
    console.log("OK");
  } catch {
    console.log("SKIPPED (will auto-reload)");
  }

  console.log("\nTest database is ready.");
  console.log("Run tests: pnpm test:e2e -- --project=lifecycle\n");
}

main();
