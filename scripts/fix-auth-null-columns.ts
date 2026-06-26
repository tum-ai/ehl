/**
 * Repair GoTrue NULL string columns in auth.users on a Supabase instance.
 *
 * When auth.users rows are bulk-inserted via SQL (sim/import) instead of the
 * admin API, GoTrue's string token columns can be left NULL. GoTrue then throws
 * "Database error" on listUsers / getUserById / deleteUser for those rows, which
 * makes E2E cleanup unable to delete them and blocks tests that re-register the
 * same email. This sets the offending columns to '' (the value the admin API
 * uses), which is the fix recommended by scripts/check-auth-integrity.ts.
 *
 * Usage (TEST instance):
 *   pnpm exec dotenv -e .env.supabase -- tsx scripts/fix-auth-null-columns.ts
 *
 * Requires SUPABASE_ACCESS_TOKEN and SUPABASE_TEST_REF (from .env.supabase).
 * Runs against the TEST ref only; never production.
 */
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const TEST_REF = process.env.SUPABASE_TEST_REF;

if (!ACCESS_TOKEN || !TEST_REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_TEST_REF (from .env.supabase)");
  process.exit(1);
}

// The string columns GoTrue expects to be '' (not NULL). NULL in any of these
// makes the GoTrue admin API throw for that row.
const COLUMNS = [
  "confirmation_token",
  "recovery_token",
  "email_change",
  "email_change_token_new",
  "email_change_token_current",
  "phone_change",
  "phone_change_token",
  "reauthentication_token",
];

const setClauses = COLUMNS.map((c) => `${c} = coalesce(${c}, '')`).join(",\n    ");
const whereClauses = COLUMNS.map((c) => `${c} is null`).join("\n     or ");

const sql = `
update auth.users
   set ${setClauses}
 where ${whereClauses};
`;

async function runSql(query: string) {
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
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

(async () => {
  console.log(`[fix-auth-null-columns] repairing auth.users on ref ${TEST_REF}`);
  // Count affected rows first (read-only), then repair.
  const before = await runSql(
    `select count(*)::int as n from auth.users where ${whereClauses};`
  );
  const n = before?.[0]?.n ?? before?.result?.[0]?.n ?? "unknown";
  console.log(`[fix-auth-null-columns] rows with NULL token columns: ${JSON.stringify(n)}`);

  await runSql(sql);
  console.log("[fix-auth-null-columns] repair applied.");

  const after = await runSql(
    `select count(*)::int as n from auth.users where ${whereClauses};`
  );
  const m = after?.[0]?.n ?? after?.result?.[0]?.n ?? "unknown";
  console.log(`[fix-auth-null-columns] remaining NULL rows after repair: ${JSON.stringify(m)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
