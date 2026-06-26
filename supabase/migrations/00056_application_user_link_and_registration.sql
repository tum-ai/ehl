-- Link applications to accounts + support apply-creates-account.
--
-- Two changes:
--  1. `applications.user_id` — a nullable FK to profiles(id). Applying to a
--     chapter now creates (or reuses) an account, so a new application is linked
--     to its profile by id, not only by the fragile email match. Nullable +
--     backfilled so LEGACY accountless applications keep working unchanged.
--  2. `application_registration` verification type — applying through the public
--     form now goes through the same email-verification-code flow as registration
--     (the code is the spam gate), so the account + profile + application are only
--     created after the email is verified.

-- ── 1. applications.user_id ────────────────────────────────────────────────
alter table applications
  add column if not exists user_id uuid references profiles(id) on delete set null;

create index if not exists idx_applications_user_id on applications(user_id);

-- Backfill: link existing applications to a profile with the same email.
update applications a
set user_id = p.id
from profiles p
where a.user_id is null
  and lower(a.email) = lower(p.email);

-- A signed-in/account-linked applicant may have at most one application per
-- chapter. The legacy UNIQUE(chapter_id, email) stays for email-only rows; this
-- partial unique covers the linked rows without affecting NULL-user_id legacy ones.
create unique index if not exists uniq_applications_chapter_user
  on applications(chapter_id, user_id)
  where user_id is not null;

-- ── 2. verification_codes: allow the application_registration type ─────────
-- Idempotent constraint swap (mirrors 00011). Guard so it is a no-op if the
-- table somehow isn't present yet on an out-of-order apply.
do $$
begin
  if to_regclass('public.verification_codes') is not null then
    alter table verification_codes drop constraint if exists verification_codes_type_check;
    alter table verification_codes add constraint verification_codes_type_check
      check (type = any (array[
        'registration'::text,
        'member_confirm'::text,
        'solo_registration'::text,
        'application_registration'::text
      ]));
  end if;
end $$;
