# Production Migration Reconciliation Plan

Prepared during pre-Paris simulation work. **Apply to production ONLY after the
full simulation is green AND with explicit go-ahead.** All prod reads so far were
read-only; nothing has been applied to prod.

## Goal

Bring production in sync with the repo's migrations so the schema Paris runs on is
reproducible and correct. Production is currently:
- **Missing** migrations: `00025` (audit-log immutable), `00026` (per-juror jury
  feedback), `00031` (submissions-lock RLS).
- **Has** an out-of-band column `chapters.photo_album_url` (now captured by `00043`).
- **Missing** `00042` (Entire: entire_required, session_history) — from the Entire PR.

## Safety findings (verified read-only against prod)

Row counts in prod for tables these migrations touch:

| Table | Rows | Note |
|---|---|---|
| jury_feedback | 0 | 00026 deletes null-`entered_by` rows + re-keys PK → safe NOW (empty) |
| admin_audit_log | 0 | 00025 swaps policies → safe |
| submissions | 0 | 00031 swaps policies → safe |
| jury_rankings | 0 | unaffected |
| scores | 97 | NOT touched by any of these migrations |

**Key timing point:** `00026` runs `delete from jury_feedback where entered_by is null`.
That is harmless now (0 rows) but would DESTROY data if applied after Paris generates
jury feedback. **Apply BEFORE Paris**, while the table is empty.

## Ordered apply plan (idempotent where possible)

Apply in this order to the **production** project (and confirm test already has them):

1. `00025_audit_log_immutable.sql` — DROP/CREATE policies. Idempotent (DROP IF EXISTS).
2. `00026_jury_feedback_per_juror.sql` — adds `entered_by`, re-keys PK, deletes null rows.
   - NOT idempotent (will error if `entered_by` already exists). Pre-check:
     `select column_name from information_schema.columns where table_name='jury_feedback' and column_name='entered_by';`
     If present, SKIP this migration.
3. `00031_submissions_lock_rls.sql` — DROP/CREATE policies. Idempotent (DROP IF EXISTS).
4. `00042_entire_session_history.sql` — ADD COLUMN IF NOT EXISTS ×2. Idempotent.
5. `00043_reconcile_photo_album_url.sql` — ADD COLUMN IF NOT EXISTS. Idempotent (prod already has the column; no-op).

Use `scripts/db-migrate.sh <file>` (applies to BOTH prod + test, per the dual-DB rule).
For `00026`, run the pre-check first; if it would re-error, apply only the parts prod lacks.

## Pre-apply checklist

- [ ] Full UI simulation green on the reconciled (repo) schema.
- [ ] Take a fresh prod backup / snapshot (Supabase dashboard → Database → Backups) before applying.
- [ ] Re-confirm row counts above are still 0 for jury_feedback/admin_audit_log/submissions.
- [ ] Confirm no prod process updates/deletes `admin_audit_log` rows (00025 makes it append-only).
- [ ] Maintenance window or low-traffic moment (well before Paris).

## Apply + verify

```
# Backup first (dashboard). Then, for each migration file in order:
./scripts/db-migrate.sh supabase/migrations/00025_audit_log_immutable.sql
# (00026: run the entered_by pre-check; apply only if absent)
./scripts/db-migrate.sh supabase/migrations/00031_submissions_lock_rls.sql
./scripts/db-migrate.sh supabase/migrations/00042_entire_session_history.sql
./scripts/db-migrate.sh supabase/migrations/00043_reconcile_photo_album_url.sql
```

After applying, re-run the prod-vs-repo schema diff (columns + RLS policies) and
confirm ZERO drift remains. Update SCHEMA_DRIFT_REPORT.md to "reconciled".

## Rollback

- Policy changes (00025/00031): re-create the prior single ALL policy if needed
  (definitions preserved in SCHEMA_DRIFT_REPORT.md / git history of 00003).
- 00026: additive column + PK change; with 0 rows, dropping `entered_by` and
  restoring the old PK reverts it.
- 00042/00043: drop the added columns (nullable, no data dependency yet).
