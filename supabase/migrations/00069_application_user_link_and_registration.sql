-- Link applications to accounts + support apply-creates-account.
--
-- Two changes:
--  1. `applications.user_id`: a nullable FK to profiles(id). Applying to a
--     chapter now creates (or reuses) an account, so an application is linked to
--     its profile by id, not only by the email match. Nullable so LEGACY
--     accountless applications keep working unchanged.
--  2. `application_registration` verification type: applying through the public
--     form now goes through the same email-verification-code flow as registration
--     (the code is the spam gate), so the account and the application are only
--     created after the email is verified.
--
-- The link is kept by TRIGGERS rather than by each code path, the same reasoning
-- as 00055: applications are inserted from several places (the apply form,
-- walk-in, the Finale invite, admin tools), and accounts are created from several
-- more. A column only some of those paths remember to set is a trap, so the
-- database fills it in both directions:
--   - an application inserted for an email that already has a profile gets that
--     profile's id;
--   - a profile created (or given its email) later links every still-unlinked
--     application with that email.
-- Linking by email grants nothing new: every participant read of applications
-- already matches on the profile's email (the "Users read own applications"
-- policy, the dashboard). That makes profiles.email an identity, which is why
-- 00070 stops participants from changing their own.
--
-- No unique index on (chapter_id, user_id): UNIQUE(chapter_id, email) from 00004
-- already allows one application per person per chapter, and a second index could
-- make the backfill below fail on historical rows whose emails differ only in case.

-- ── 1. applications.user_id ────────────────────────────────────────────────
alter table applications
  add column if not exists user_id uuid references profiles(id) on delete set null;

create index if not exists idx_applications_user_id on applications(user_id);

-- Backfill: link existing applications to the profile with the same email. Only
-- when exactly ONE profile matches case-insensitively, so an ambiguous match is
-- left unlinked instead of picking one at random.
update applications a
set user_id = m.profile_id
from (
  select lower(email) as email_lc, min(id::text)::uuid as profile_id
  from profiles
  where email is not null
  group by lower(email)
  having count(*) = 1
) m
where a.user_id is null
  and lower(a.email) = m.email_lc;

-- Application side: on insert, fill user_id from the matching profile (a
-- user_id the caller set is kept). On an email CHANGE, recompute it from the new
-- address: keeping the old link would leave the row owned by one account while
-- the email-based read policy shows it to another.
create or replace function public.link_application_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_id uuid;
  match_count int;
begin
  if tg_op = 'UPDATE' then
    if new.email is not distinct from old.email then
      return new;
    end if;
    new.user_id := null;
  end if;

  if new.user_id is null and new.email is not null then
    select min(p.id::text)::uuid, count(*) into match_id, match_count
    from public.profiles p
    where lower(p.email) = lower(new.email);
    -- Link only an unambiguous match.
    if match_count = 1 then
      new.user_id := match_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists link_application_to_profile on applications;
create trigger link_application_to_profile
  before insert or update of email on applications
  for each row
  execute function public.link_application_to_profile();

-- Profile side: link still-unlinked applications once the profile has an email.
-- Covers an applicant who registers after applying, and the 00055 trigger's case
-- where a profile is first created without an email and given one later.
create or replace function public.link_profile_applications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null
     and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    update public.applications
    set user_id = new.id
    where user_id is null
      and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists link_profile_applications on profiles;
create trigger link_profile_applications
  after insert or update of email on profiles
  for each row
  execute function public.link_profile_applications();

-- ── 2. verification_codes: allow the application_registration type ─────────
-- Idempotent constraint swap (mirrors 00011). Guarded like 00011 so a clean-room
-- apply never depends on the table's ad-hoc history.
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
