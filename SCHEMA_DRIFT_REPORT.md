# Schema Drift Report — Production vs Test vs Repo Migrations

## STATUS: RECONCILED (2026-06-17)

Prod and test schemas now match (255 columns each, zero diff; RLS policies aligned).
Applied to production after the local simulation passed and with explicit approval:
- **00025** (audit-log immutable) — applied to prod.
- **00042** (entire_required, session_history) — applied to prod.
- **00026 / 00031 / 00043** — were already present in prod (verified), skipped.
- **00044** (submissions read = team-members) — NEW migration that makes the REPO
  match prod's existing, intended behavior (any team member may read their team's
  submission), instead of restricting to president-only. Applied to both.

Verified post-migration: applications table intact (690 total, Paris 180), a new
Paris application submitted end-to-end through the real UI against the prod DB and
then cleaned up. See PROD_MIGRATION_PLAN.md.

---

Generated during pre-Paris simulation setup.
All prod reads were read-only via the Supabase management API.

## Summary

Production has diverged from the repo's migrations in BOTH directions:

1. **Prod is MISSING migrations that exist in the repo and in test.**
2. **Prod has a column that exists in NO migration** (applied out-of-band).

This means a fresh DB built purely from `supabase/migrations/` would NOT match production,
and production is NOT fully reproducible from the repo. Relevant for Paris (1.5 weeks out).

## 1. Prod missing migrations (prod is BEHIND repo + test)

Test/repo have these RLS changes; production does not:

| Missing in prod | Source migration | Effect |
|---|---|---|
| `jury_feedback: Jury update own feedback` (UPDATE) | `00026_jury_feedback_per_juror.sql` | Per-juror feedback edit not enforced as in repo |
| `admin_audit_log` split into `Admin insert audit log` + `Admin read audit log` | `00025_audit_log_immutable.sql` | Prod still has single `Admin full access audit log` (ALL) — audit log NOT immutable in prod |
| `submissions: Public read own submissions` (replaces `Team members read own submissions`) | `00031_submissions_lock_rls.sql` | Submissions-lock RLS differs in prod |

(There is also a `jury_feedback: Jury create feedback` INSERT policy whose definition differs
between prod and test — same name, different body — from the 00026 change.)

## 2. Prod-only column, in no migration

- `chapters.photo_album_url` exists in **production** but in **no migration file**.
- The app code uses it: `lib/queries/mappers.ts:57` (read), `lib/actions/admin.ts:303` (write).
- It was missing from **test**, so admin actions writing photo_album_url would FAIL against test.
- Fix: a reconciling migration adds it so migrations reproduce prod (see migration 00043).

## 3. Confirmed safe

- Migration `00042` (entire_required, session_history) is purely additive; test = prod + exactly
  those two columns. Safe to apply to prod.
- Tables and functions are identical between prod and test.

## Recommended actions (require explicit approval before touching prod)

1. Apply pending migrations to production so it matches the repo: **00025, 00026, 00031** (and 00042).
   - NOTE: `00025` makes the audit log immutable. Verify no prod process relies on updating/deleting
     audit rows before applying.
2. Apply the new reconciling migration `00043` (photo_album_url) to BOTH DBs.
3. After reconciliation, re-run the prod-vs-repo schema diff to confirm zero drift.

Until prod is reconciled, the simulation runs against the **repo's intended schema** (test rebuilt to
match migrations + reconciliation), i.e. what Paris SHOULD run — not the current drifted prod.
