-- Prevent profile creation with elevated roles via direct REST API.
--
-- Migration 00030 blocks role changes on UPDATE, but INSERT has no
-- constraint. A user could theoretically insert a profile with
-- role='admin' or role='jury' via the Supabase REST API.
--
-- Fix: BEFORE INSERT trigger that rejects role != 'participant'
-- unless the caller is service_role (used by createAdminClient).
-- All legitimate profile creation goes through adminClient.

create or replace function prevent_role_on_insert()
returns trigger as $$
begin
  -- Allow participant role (the safe default)
  if NEW.role = 'participant' or NEW.role is null then
    return NEW;
  end if;

  -- Allow if caller is service_role (adminClient)
  if current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role' then
    return NEW;
  end if;

  raise exception 'only participant profiles can be created via client'
    using errcode = '42501'; -- insufficient_privilege
end;
$$ language plpgsql security definer;

create trigger profiles_prevent_role_on_insert
  before insert on profiles
  for each row
  execute function prevent_role_on_insert();
