/**
 * Migration verification manifest.
 *
 * One entry per migration file in supabase/migrations/. Each entry carries a
 * read-only SQL probe that returns a single column `present` (boolean): true
 * iff the schema artifact that migration creates is present in the target
 * database. scripts/check-migrations-applied.ts runs every probe and reports
 * which migrations are missing.
 *
 * We do NOT rely on a schema_migrations tracking table: migrations in this repo
 * are applied ad-hoc via the Management API (scripts/db-migrate.sh,
 * apply-migrations-via-api.ts), so no such ledger exists. Instead each probe
 * asserts the *effect* of the migration directly against the live catalog
 * (information_schema / pg_catalog). That is what actually matters: "does prod
 * have this column/table/policy/enum value", not "did a row get written".
 *
 * RULE (also in CLAUDE.md): every NEW migration MUST add an entry here, keyed
 * by its file prefix, in the same PR. Pick the most distinctive artifact the
 * migration introduces (a new table, column, constraint, enum value, policy,
 * index, function, or view-definition fragment) so the probe uniquely proves
 * that migration ran. The manifest is checked for completeness against the
 * migrations directory, so a missing entry fails the check loudly.
 *
 * Probe helpers below keep the SQL terse and consistent. Each returns a query
 * string selecting `exists(...) as present`.
 */

/** A table exists in the public schema. */
const table = (name: string) =>
  `select exists (
     select 1 from information_schema.tables
     where table_schema = 'public' and table_name = '${name}'
   ) as present`;

/** A column exists on a public table. */
const column = (tbl: string, col: string) =>
  `select exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = '${tbl}' and column_name = '${col}'
   ) as present`;

/** A named constraint exists on a public table. */
const constraint = (tbl: string, name: string) =>
  `select exists (
     select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = '${tbl}' and constraint_name = '${name}'
   ) as present`;

/** An enum type has a given label. */
const enumValue = (typeName: string, label: string) =>
  `select exists (
     select 1 from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     where t.typname = '${typeName}' and e.enumlabel = '${label}'
   ) as present`;

/** An RLS policy with a given name exists on a public table. */
const policy = (tbl: string, name: string) =>
  `select exists (
     select 1 from pg_policies
     where schemaname = 'public' and tablename = '${tbl}' and policyname = '${name}'
   ) as present`;

/** An index with a given name exists in the public schema. */
const index = (name: string) =>
  `select exists (
     select 1 from pg_indexes
     where schemaname = 'public' and indexname = '${name}'
   ) as present`;

/** A function with a given name exists in the public schema. */
const fn = (name: string) =>
  `select exists (
     select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '${name}'
   ) as present`;

/** A view exists in the public schema. */
const view = (name: string) =>
  `select exists (
     select 1 from information_schema.views
     where table_schema = 'public' and table_name = '${name}'
   ) as present`;

/** Row-level security is enabled on a public table. */
const rlsEnabled = (name: string) =>
  `select coalesce(
     (select relrowsecurity from pg_class where oid = 'public.${name}'::regclass),
     false
   ) as present`;

export interface MigrationCheck {
  /** File prefix, e.g. "00045". Matched against supabase/migrations/<prefix>_*.sql. */
  prefix: string;
  /** Human label (usually the migration filename without prefix). */
  label: string;
  /**
   * Read-only SQL returning a single `present` boolean column. Omit ONLY when
   * the migration has no independently observable artifact — in that case set
   * `unverifiable` to explain why.
   */
  sql?: string;
  /**
   * Set instead of `sql` when the migration produces no artifact that can be
   * probed independently, so we never assert a false signal. The runner reports
   * these as "[UNVERIFIABLE]" (not OK/missing) and does not fail on them.
   *
   *   reason  — short, honest explanation of why it can't be probed.
   *   coveredBy — optional prefix of a later migration whose probe verifies the
   *               relevant NET schema state (for "reverted by" / "absorbed by"
   *               cases). Purely informational; the named probe still runs on
   *               its own line.
   */
  unverifiable?: { reason: string; coveredBy?: string };
}

/**
 * One entry per migration. Ordered by prefix. Keep in sync with
 * supabase/migrations/ — the runner asserts every migration file has an entry.
 */
export const MIGRATION_CHECKS: MigrationCheck[] = [
  { prefix: "00001", label: "initial_schema", sql: table("profiles") },
  { prefix: "00002", label: "add_date_end", sql: column("chapters", "date_end") },
  { prefix: "00003", label: "phase2_schema", sql: table("challenges") },
  { prefix: "00004", label: "applications", sql: table("applications") },
  { prefix: "00005", label: "screening_and_join_requests", sql: table("screening_scores") },
  { prefix: "00006", label: "jury_individual_votes", sql: constraint("jury_rankings", "jury_rankings_unique_per_juror") },
  { prefix: "00007", label: "default_challenge_reg_enabled", sql: `select (
     select column_default = 'true'
     from information_schema.columns
     where table_schema = 'public' and table_name = 'chapters'
       and column_name = 'challenge_registration_enabled'
   ) as present` },
  { prefix: "00008", label: "partner_tiers_and_scored_challenges", sql: column("challenges", "is_scored") },
  { prefix: "00009", label: "admin_audit_log", sql: table("admin_audit_log") },
  { prefix: "00010", label: "admin_emails", sql: table("admin_emails") },
  { prefix: "00011", label: "registration_refactor", sql: table("team_invites") },
  { prefix: "00012", label: "challenge_brief", sql: column("challenges", "brief_file_id") },
  { prefix: "00013", label: "submission_fork_url", sql: column("submissions", "fork_url") },
  { prefix: "00014", label: "invite_jury_to_forks", sql: column("challenges", "invite_jury_to_forks") },
  { prefix: "00015", label: "app_settings", sql: table("app_settings") },
  { prefix: "00016", label: "code_review_v2", sql: column("code_reviews", "review_version") },
  { prefix: "00017", label: "code_review_queue", sql: constraint("code_reviews", "code_reviews_submission_id_unique") },
  { prefix: "00018", label: "code_review_progress", sql: column("code_reviews", "progress") },
  { prefix: "00019", label: "fix_applications_team_fk", sql: `select exists (
     select 1 from information_schema.referential_constraints rc
     join information_schema.table_constraints tc
       on tc.constraint_name = rc.constraint_name
      and tc.constraint_schema = rc.constraint_schema
     where tc.table_schema = 'public' and tc.table_name = 'applications'
       and rc.constraint_name = 'applications_existing_team_id_fkey'
       and rc.delete_rule = 'SET NULL'
   ) as present` },
  // 00020 ADDs the `attempts` column, but 00021 creates verification_codes WITH
  // `attempts` already in the CREATE TABLE — so the column is present whenever
  // 00021 ran, regardless of 00020. No artifact uniquely proves 00020.
  { prefix: "00020", label: "verification_attempts", unverifiable: {
     reason: "attempts column is also created by 00021's CREATE TABLE; no artifact unique to 00020",
     coveredBy: "00021",
   } },
  // The table is CREATE TABLE IF NOT EXISTS and (per the migration's own note)
  // was "missing from migration history", so on some DBs it predates 00021.
  // The index it creates is the artifact unique to 00021.
  { prefix: "00021", label: "create_verification_codes", sql: index("idx_verification_codes_email_code") },
  // 00022 only ENABLEs RLS on verification_codes and deliberately adds NO policy
  // ("no policies = deny all"). Assert RLS is on, not a non-existent policy.
  { prefix: "00022", label: "verification_codes_rls", sql: rlsEnabled("verification_codes") },
  // 00023 created idx_team_members_unique_user, but 00024 DROPS it. Its only
  // artifact no longer exists on a fully-migrated DB — 00024's probe (index
  // absent) covers the net state.
  { prefix: "00023", label: "unique_team_member", unverifiable: {
     reason: "its only artifact (idx_team_members_unique_user) is dropped by 00024",
     coveredBy: "00024",
   } },
  { prefix: "00024", label: "drop_unique_user_allow_chapter_lock", sql: `select not exists (
     select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_team_members_unique_user'
   ) as present` },
  { prefix: "00025", label: "audit_log_immutable", sql: policy("admin_audit_log", "Admin insert audit log") },
  { prefix: "00026", label: "jury_feedback_per_juror", sql: column("jury_feedback", "entered_by") },
  // 00027's 4 granular policies are later dropped by 00029 — but 00027 ALSO drops
  // the "Public read profiles" policy (created in 00001), which exposed every
  // profile (incl. emails) to the anon key. 00029 does NOT re-add it. That drop
  // is 00027's durable, security-critical effect, so probe its absence. (If we
  // treated 00027 as merely "superseded by 00029", a DB missing 00027 but having
  // 00028/00029 would pass while the public-read hole stayed open.)
  { prefix: "00027", label: "restrict_profiles_public_read", sql: `select not exists (
     select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
       and policyname = 'Public read profiles'
   ) as present` },
  { prefix: "00028", label: "profiles_authenticated_read", sql: policy("profiles", "Authenticated users read profiles") },
  { prefix: "00029", label: "drop_recursive_profiles_policies", sql: `select not exists (
     select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
       and policyname = 'Users read teammate profiles'
   ) as present` },
  { prefix: "00030", label: "prevent_role_escalation", sql: fn("prevent_role_change") },
  // 00031 creates "President insert/update submissions" — but 00035 later drops
  // and RE-creates those same two policies, so their presence does not prove
  // 00031 ran. 00031's durable effect is dropping the old broad "President manage
  // submissions" policy (from 00003) that allowed writes past the deadline lock.
  // Probe that policy's ABSENCE. (00035 never re-adds it, so this stays correct.)
  { prefix: "00031", label: "submissions_lock_rls", sql: `select not exists (
     select 1 from pg_policies
     where schemaname = 'public' and tablename = 'submissions'
       and policyname = 'President manage submissions'
   ) as present` },
  { prefix: "00032", label: "participant_flags", sql: table("participant_flags") },
  // 00033 is a defensive `DROP CONSTRAINT IF EXISTS admin_email_domain`. The
  // public migration lineage NEVER creates that constraint (00010 explicitly
  // adds none), so `not exists(...)` would be true on any DB — even one where
  // 00033 never ran. There is no artifact that proves 00033 was applied. It
  // exists only to clean up legacy out-of-band state on databases predating the
  // open-source rewrite, so we cannot attribute the constraint's absence to it.
  { prefix: "00033", label: "configurable_admin_domain", unverifiable: {
     reason: "defensive DROP IF EXISTS of a constraint the lineage never creates; no observable artifact",
   } },
  { prefix: "00034", label: "consent_media_ip_sponsor", sql: column("applications", "consent_media") },
  { prefix: "00035", label: "security_hardening", sql: fn("check_team_member_chapter_lock") },
  { prefix: "00036", label: "event_log", sql: table("event_log") },
  { prefix: "00037", label: "rename_chapter_phases", sql: enumValue("chapter_status", "preparation") },
  // The leaderboard view already exists from 00001; 00038 CREATE OR REPLACEs it
  // to add the sort_name tiebreaker column. Probe that column (view columns show
  // up in information_schema.columns), not the view's mere existence.
  { prefix: "00038", label: "leaderboard_tiebreaker", sql: column("leaderboard", "sort_name") },
  { prefix: "00039", label: "drop_chapter_unlocks", sql: `select not exists (
     select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'chapter_unlocks'
   ) as present` },
  { prefix: "00040", label: "prevent_role_on_insert", sql: fn("prevent_role_on_insert") },
  { prefix: "00041", label: "challenge_registration_rls", sql: policy("challenge_registrations", "President read registrations") },
  { prefix: "00042", label: "entire_session_history", sql: column("challenges", "entire_required") },
  { prefix: "00043", label: "reconcile_photo_album_url", sql: column("chapters", "photo_album_url") },
  { prefix: "00044", label: "submissions_read_team_members", sql: policy("submissions", "Team members read own submissions") },
  { prefix: "00045", label: "chapter_admin_role", sql: enumValue("user_role", "chapter_admin") },
  { prefix: "00046", label: "chapter_admins", sql: table("chapter_admins") },
  { prefix: "00047", label: "chapter_admins_unique_user", sql: constraint("chapter_admins", "chapter_admins_user_id_unique") },
  { prefix: "00048", label: "cron_lock", sql: fn("try_acquire_cron_lock") },
  { prefix: "00049", label: "application_cancel_and_notes", sql: table("application_notes") },
  { prefix: "00050", label: "delete_chapter_cascade", sql: fn("delete_chapter_cascade") },
  { prefix: "00051", label: "entire_required_default_true", sql: `select (
     select column_default = 'true'
     from information_schema.columns
     where table_schema = 'public' and table_name = 'challenges'
       and column_name = 'entire_required'
   ) as present` },
  { prefix: "00052", label: "chapter_communications", sql: `select exists (
     select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'chapter_communications'
   ) and exists (
     select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'chapter_broadcasts'
   ) as present` },
  { prefix: "00053", label: "partner_tier_data_migration", unverifiable: {
     reason: "pure data UPDATE (re-tagging legacy partner tiers) split out of 00008 so a " +
       "newly-added enum value is not USED in the same transaction it was added in. The enum " +
       "values are introduced (and probed) by 00008; the legacy values still exist on the type " +
       "and the partners table is empty on a fresh DB, so this UPDATE leaves no schema artifact " +
       "and is a no-op except on DBs that still hold pre-migration partner rows. Nothing to probe.",
   } },
  { prefix: "00054", label: "walk_in_token", sql: table("chapter_walk_in") },
  { prefix: "00055", label: "auto_create_profile_on_auth_user", sql: fn("handle_new_auth_user") },
  { prefix: "00056", label: "application_user_link_and_registration", sql: column("applications", "user_id") },
];

/**
 * Assert the manifest covers exactly the migration files passed in (each as its
 * 5-char numeric prefix). Returns a list of human-readable problems; empty means
 * the manifest is complete and consistent. Pure so it can be unit-tested without
 * a DB and reused by the runner.
 */
export function findManifestProblems(filePrefixes: string[]): string[] {
  const manifestPrefixes = new Set(MIGRATION_CHECKS.map((c) => c.prefix));
  const fileSet = new Set(filePrefixes);
  const problems: string[] = [];

  for (const p of filePrefixes) {
    if (!manifestPrefixes.has(p)) {
      problems.push(`Migration ${p}_*.sql has NO entry in migration-checks.ts. Add one.`);
    }
  }
  const seen = new Set<string>();
  for (const c of MIGRATION_CHECKS) {
    if (seen.has(c.prefix)) problems.push(`Duplicate manifest entry for ${c.prefix}.`);
    seen.add(c.prefix);
    if (!fileSet.has(c.prefix)) {
      problems.push(`Manifest entry ${c.prefix} has no matching migration file.`);
    }
    // Each entry must be probeable XOR explicitly marked unverifiable.
    if (c.unverifiable) {
      if (c.sql) {
        problems.push(`Entry ${c.prefix} has both sql and unverifiable; pick one.`);
      }
      if (!c.unverifiable.reason) {
        problems.push(`Entry ${c.prefix} is unverifiable but gives no reason.`);
      }
      if (c.unverifiable.coveredBy && !fileSet.has(c.unverifiable.coveredBy)) {
        problems.push(`Entry ${c.prefix} is coveredBy ${c.unverifiable.coveredBy}, which is not a migration file.`);
      }
    } else if (!c.sql) {
      problems.push(`Entry ${c.prefix} has no sql and is not marked unverifiable. Add a probe or mark it unverifiable.`);
    }
  }
  return problems;
}
