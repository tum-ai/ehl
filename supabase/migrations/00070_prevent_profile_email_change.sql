-- Participants cannot change their own profiles.email.
--
-- The "Admin full access profiles" policy (00001) is FOR ALL USING
-- (auth.uid() = id OR service_role), so any signed-in user can UPDATE their own
-- row through the REST API. 00030 closed that for `role`; `email` stayed open.
-- profiles.email is used as an IDENTITY everywhere: the "Users read own
-- applications" policy matches it, the apply flow resolves an existing account
-- by it, and 00069 links applications to the profile that holds it. A user who
-- set their profile email to someone else's address could read that person's
-- applications and have them linked to their own account.
--
-- No feature lets a participant change their email: the only writer is the
-- admin "change email" action, which runs as the service role and updates the
-- auth user in the same step. So an email change is allowed only from the
-- service role, or from a direct database session (migrations, seed scripts),
-- which carries no request JWT at all. A request made as `anon` or
-- `authenticated` is refused.

create or replace function public.prevent_profile_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not distinct from old.email then
    return new;
  end if;

  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '')
       in ('authenticated', 'anon') then
    raise exception 'email changes are not allowed'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_email_change on profiles;
create trigger profiles_prevent_email_change
  before update of email on profiles
  for each row
  execute function public.prevent_profile_email_change();
