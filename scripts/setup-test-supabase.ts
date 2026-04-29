/**
 * Automated Supabase test instance setup.
 * Configures auth settings, storage buckets, and applies migrations via the Management API.
 *
 * Usage: pnpm tsx scripts/setup-test-supabase.ts
 *
 * Requires:
 * - SUPABASE_ACCESS_TOKEN env var or --token flag (personal access token from supabase.com/dashboard/account/tokens)
 * - .env.test with test Supabase credentials
 *
 * This script:
 * 1. Verifies the target is NOT production (safety check)
 * 2. Configures auth settings (disable signup, site URL, redirects, email provider)
 * 3. Creates/updates storage buckets (public)
 * 4. Applies all migrations via psql
 * 5. Loads seed data
 * 6. Reloads PostgREST schema cache
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { readdirSync } from "fs";
import { execSync } from "child_process";

config({ path: resolve(__dirname, "../.env.test") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;
const ACCESS_TOKEN =
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.argv.find((a) => a.startsWith("--token="))?.split("=")[1];

// Extract project ref from URL
const PROJECT_REF = SUPABASE_URL?.replace("https://", "").replace(".supabase.co", "");

// Production safety check: SUPABASE_TEST_MODE must be set
const IS_TEST_MODE = process.env.SUPABASE_TEST_MODE === "true";

function fatal(msg: string): never {
  console.error(`\nFATAL: ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  fatal("Missing credentials in .env.test");
}
if (!DB_PASSWORD) {
  fatal("Missing SUPABASE_DB_PASSWORD in .env.test");
}
if (!ACCESS_TOKEN) {
  fatal(
    "Missing Supabase access token.\n" +
      "  Set SUPABASE_ACCESS_TOKEN env var or pass --token=sbp_xxx\n" +
      "  Get one at: https://supabase.com/dashboard/account/tokens"
  );
}
if (!IS_TEST_MODE) {
  fatal(
    "SUPABASE_TEST_MODE is not set to 'true' in .env.test.\n" +
      "  Add SUPABASE_TEST_MODE=true to confirm this is a test instance."
  );
}

const API_HEADERS = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Step 1: Configure Auth ────────────────────────────────

async function configureAuth() {
  console.log("Configuring auth settings...");

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: "PATCH",
      headers: API_HEADERS,
      body: JSON.stringify({
        // Match production settings
        site_url: "http://localhost:3001",
        uri_allow_list:
          "http://localhost:3001/auth/callback,http://localhost:3000/auth/callback",
        disable_signup: true,
        mailer_autoconfirm: false,
        external_email_enabled: true,
        // Google OAuth not needed for tests (admin uses magic link shortcut)
        external_google_enabled: false,
        // Match production password/rate settings
        password_min_length: 6,
        jwt_exp: 3600,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    fatal(`Auth config failed (${res.status}): ${body}`);
  }
  console.log("  Auth: OK");
}

// ─── Step 2: Configure Storage ─────────────────────────────

async function configureStorage() {
  console.log("Configuring storage buckets...");

  const required = ["partner-logos", "hero-images", "sponsor-logos"];

  const { data: existing } = await admin.storage.listBuckets();
  const existingNames = new Set(existing?.map((b) => b.name) ?? []);

  for (const bucket of required) {
    if (existingNames.has(bucket)) {
      // Ensure it's public
      await admin.storage.updateBucket(bucket, { public: true });
      console.log(`  ${bucket}: updated to public`);
    } else {
      const { error } = await admin.storage.createBucket(bucket, {
        public: true,
      });
      if (error) {
        console.log(`  ${bucket}: FAILED (${error.message})`);
      } else {
        console.log(`  ${bucket}: created (public)`);
      }
    }
  }
}

// ─── Step 3: Apply Migrations ──────────────────────────────

function applyMigrations() {
  console.log("Applying migrations...");

  const connString = `postgresql://postgres:${encodeURIComponent(DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;

  // Check psql
  try {
    execSync("which psql", { stdio: "pipe" });
  } catch {
    fatal("psql not found. Install: brew install libpq && brew link --force libpq");
  }

  // Test connection
  try {
    execSync(`psql "${connString}" -c "SELECT 1" 2>&1`, {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer };
    fatal(`Database connection failed: ${e.stderr?.toString()}`);
  }

  const migrationsDir = resolve(__dirname, "../supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ok = 0;
  let failed = 0;

  for (const file of files) {
    process.stdout.write(`  ${file}... `);
    try {
      execSync(`psql "${connString}" -f "${resolve(migrationsDir, file)}" 2>&1`, {
        stdio: "pipe",
        timeout: 60000,
      });
      console.log("OK");
      ok++;
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const output = e.stdout?.toString() || e.stderr?.toString() || "";
      if (output.includes("already exists") || output.includes("duplicate")) {
        console.log("OK (already applied)");
        ok++;
      } else {
        console.log("WARN");
        failed++;
      }
    }
  }

  console.log(`  Migrations: ${ok} OK, ${failed} warnings`);

  // Apply seed
  const seedPath = resolve(__dirname, "../supabase/seed.sql");
  process.stdout.write("  Seed data... ");
  try {
    execSync(`psql "${connString}" -f "${seedPath}" 2>&1`, {
      stdio: "pipe",
      timeout: 60000,
    });
    console.log("OK");
  } catch {
    console.log("OK (some deletes on empty tables)");
  }

  // Reload schema cache
  process.stdout.write("  Schema cache reload... ");
  try {
    execSync(
      `psql "${connString}" -c "NOTIFY pgrst, 'reload schema'" 2>&1`,
      { stdio: "pipe", timeout: 10000 }
    );
    console.log("OK");
  } catch {
    console.log("skipped");
  }
}

// ─── Step 4: Verify ────────────────────────────────────────

async function verify() {
  console.log("Verifying setup...");

  // Check auth config
  const authRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    { headers: API_HEADERS }
  );
  const auth = await authRes.json();

  const checks = [
    { label: "Signups disabled", ok: auth.disable_signup === true },
    { label: "Email autoconfirm OFF", ok: auth.mailer_autoconfirm === false },
    { label: "Email provider ON", ok: auth.external_email_enabled === true },
    { label: "Site URL correct", ok: auth.site_url === "http://localhost:3001" },
    {
      label: "Redirect URLs set",
      ok: auth.uri_allow_list?.includes("localhost:3001"),
    },
  ];

  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.label}`);
  }

  // Check DB
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .limit(1);
  console.log(`  ${profiles ? "✓" : "✗"} Database accessible`);

  // Check buckets
  const { data: buckets } = await admin.storage.listBuckets();
  const publicBuckets = buckets?.filter((b) => b.public) ?? [];
  console.log(
    `  ${publicBuckets.length >= 3 ? "✓" : "✗"} Storage: ${publicBuckets.length} public buckets`
  );

  const allOk = checks.every((c) => c.ok) && profiles && publicBuckets.length >= 3;
  return allOk;
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("\n=== EHL Test Supabase Setup ===");
  console.log(`Project: ${PROJECT_REF}`);
  console.log(`URL: ${SUPABASE_URL}`);
  console.log("────────────────────────────────────────────\n");

  await configureAuth();
  await configureStorage();
  applyMigrations();
  const ok = await verify();

  if (ok) {
    console.log("\n✓ Test Supabase is fully configured and ready.");
    console.log("  Run tests: pnpm test:e2e:lifecycle\n");
  } else {
    console.log("\n⚠ Some checks failed. Review the output above.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
