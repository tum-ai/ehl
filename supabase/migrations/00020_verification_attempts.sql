-- Add attempt tracking to verification_codes to prevent brute-force attacks.
--
-- Guarded for clean-room ordering: verification_codes was originally created
-- ad-hoc (outside migration history) and only backfilled by 00021's
-- CREATE TABLE IF NOT EXISTS, which lands AFTER this file. On a fresh
-- `supabase start` / `db reset` (the ephemeral E2E stack), the table does not
-- exist yet at 00020, so this ALTER would fail. 00021 creates the table with
-- the `attempts` column already present, so skipping here on a fresh DB yields
-- the identical net schema. On the existing remote DBs (table already present)
-- the ALTER runs as before.
do $$
begin
  if to_regclass('public.verification_codes') is not null then
    alter table verification_codes
      add column if not exists attempts integer not null default 0;
  end if;
end $$;
