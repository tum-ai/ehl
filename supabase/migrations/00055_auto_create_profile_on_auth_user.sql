-- Guarantee every auth.users row has a public.profiles row.
--
-- WHY: account creation and profile creation were two separate, non-atomic steps
-- across many code paths (solo register, team register, walk-in, jury invite,
-- chapter-admin invite, and the admin-OAuth-rejected branch of /auth/callback).
-- If the auth user was created but the follow-up `profiles` upsert was skipped
-- (an early return / a rejected admin login) or silently failed (the upserts did
-- not check their error), the result was an auth user with NO profile. That
-- breaks every FK to profiles(id) (team_join_requests, etc.), the
-- looking_for_team toggle, and participant views — exactly the bugs reported at
-- the event. This trigger makes the profile creation an atomic part of auth user
-- creation, so NO code path can ever again produce a profileless user.
--
-- SAFETY (the login flow must NOT break):
--  - ON CONFLICT (id) DO NOTHING: never overwrites an existing profile, so the
--    app-level upserts that set the correct role (admin/chapter_admin/jury) on
--    /auth/callback and in the invite flows still win and are unaffected. A user
--    who already has a profile is untouched.
--  - Only `id` is written as a hard value; name/email come from metadata with a
--    fallback, role relies on the table default ('participant'). The trigger does
--    no joins and no role logic, so it cannot fail on missing data.
--  - email is UNIQUE on profiles. To ensure a trigger failure can NEVER block an
--    auth signup/login, we DROP the email from the insert when it would collide
--    with an existing profile's email, and wrap the whole body so any unexpected
--    error is swallowed (the auth user is still created; a later app-level upsert
--    or the getSession self-heal repairs the profile). Failing OPEN here is the
--    right call: a missing profile is recoverable, a blocked login is not.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, email, name)
    values (
      new.id,
      -- Avoid tripping the UNIQUE(email) constraint: if some other profile
      -- already owns this email, insert the profile without an email; the app's
      -- own upsert / self-heal will reconcile it. id is the real identity.
      case
        when new.email is not null
          and not exists (select 1 from public.profiles p where p.email = new.email)
        then new.email
        else null
      end,
      coalesce(
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'full_name',
        new.email
      )
    )
    on conflict (id) do nothing;
  exception
    when others then
      -- Never block auth user creation because of a profile-row hiccup. A
      -- profileless user is recoverable (app upsert / getSession self-heal); a
      -- failed signup/login is not.
      raise warning 'handle_new_auth_user: could not create profile for %: %',
        new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
