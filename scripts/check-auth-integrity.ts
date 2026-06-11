/**
 * Auth integrity health check. Run before launches or after any bulk
 * user import to catch data states that break GoTrue (Supabase Auth).
 *
 * Checks:
 *   1. NULL values in auth.users string columns. GoTrue cannot scan NULL
 *      into Go strings, so affected rows break login, password recovery
 *      (generateLink), getUserById, and listUsers pagination with errors
 *      like "Database error finding user". This happens when users are
 *      bulk-inserted via SQL instead of the admin API. The fix is to set
 *      the columns to '' (empty string), which is what the API writes.
 *   2. auth.users <-> profiles consistency (every auth user has a profile
 *      and vice versa).
 *   3. listUsers pagination works across the full user set.
 *
 * Read-only. Prints findings and exits 1 if anything is broken.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/check-auth-integrity.ts   # production
 *   pnpm exec dotenv -e .env.test  -- tsx scripts/check-auth-integrity.ts   # test instance
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let failures = 0;

function report(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "  [OK]  " : "  [FAIL]"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

async function listAllUsers() {
  // Small pages on purpose: with NULL-token rows, large pages are exactly
  // what fails, and we want to know WHICH page breaks.
  const users: { id: string; email?: string }[] = [];
  const perPage = 20;
  for (let page = 1; page <= 500; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return { users, error: `page ${page}: ${error.message}` };
    }
    users.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < perPage) break;
  }
  return { users, error: null };
}

async function main() {
  console.log(`[check-auth-integrity] ${SUPABASE_URL}\n`);

  // 1. listUsers pagination (also collects users for check 2)
  const { users, error: listError } = await listAllUsers();
  report(
    !listError,
    "auth.admin.listUsers paginates across all users",
    listError ?? `${users.length} users`
  );

  // 2. auth.users <-> profiles consistency
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, email");
  if (profileError) {
    report(false, "profiles readable", profileError.message);
  } else if (!listError) {
    const profileIds = new Set((profiles ?? []).map((p) => p.id));
    const authIds = new Set(users.map((u) => u.id));
    const missingProfiles = users.filter((u) => !profileIds.has(u.id));
    const orphanProfiles = (profiles ?? []).filter((p) => !authIds.has(p.id));
    report(
      missingProfiles.length === 0,
      "every auth user has a profile",
      missingProfiles.length
        ? missingProfiles
            .slice(0, 5)
            .map((u) => u.email)
            .join(", ") + (missingProfiles.length > 5 ? ", ..." : "")
        : undefined
    );
    report(
      orphanProfiles.length === 0,
      "every profile has an auth user",
      orphanProfiles.length
        ? orphanProfiles
            .slice(0, 5)
            .map((p) => p.email)
            .join(", ") + (orphanProfiles.length > 5 ? ", ..." : "")
        : undefined
    );
  }

  // 3. Spot-check that admin user lookups work for a sample of users.
  // getUserById fails with "Database error loading user" on rows with NULL
  // string columns, so probing a sample catches broken imports even though
  // the service key cannot query auth.users columns directly.
  if (!listError && users.length > 0) {
    const sampleIdx = [0, Math.floor(users.length / 2), users.length - 1];
    let lookupError: string | null = null;
    for (const idx of sampleIdx) {
      const { error } = await admin.auth.admin.getUserById(users[idx].id);
      if (error) {
        lookupError = `${users[idx].email}: ${error.message}`;
        break;
      }
    }
    report(!lookupError, "getUserById works for sampled users", lookupError ?? undefined);
  }

  console.log(
    `\n[check-auth-integrity] ${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`
  );
  if (failures > 0) {
    console.log(
      "If listUsers/getUserById fail with 'Database error', bulk-imported rows" +
        " likely have NULL in auth.users string columns (confirmation_token," +
        " recovery_token, email_change, email_change_token_new). Fix by setting" +
        " them to '' via SQL, then re-run this check."
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[check-auth-integrity] Fatal:", err);
  process.exit(1);
});
