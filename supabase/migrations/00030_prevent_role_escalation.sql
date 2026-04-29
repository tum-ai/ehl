-- Fix F-01: Prevent privilege escalation via direct profiles UPDATE.
--
-- The "Admin full access profiles" RLS policy (00001:143-147) uses
-- FOR ALL USING (auth.uid() = id OR service_role), which allows any
-- authenticated user to UPDATE their own row, including the `role`
-- field. A participant could send a PATCH to the Supabase REST API
-- setting role='admin' and gain full platform control.
--
-- Fix: A BEFORE UPDATE trigger that rejects role changes unless the
-- request comes from the service_role (used by createAdminClient).
-- This is defense-in-depth: application code already only changes
-- roles via adminClient, but the trigger blocks the REST API vector.

create or replace function prevent_role_change()
returns trigger as $$
begin
  -- Allow if role is not changing
  if NEW.role = OLD.role then
    return NEW;
  end if;

  -- Allow if caller is service_role (adminClient)
  if current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role' then
    return NEW;
  end if;

  raise exception 'role changes are not allowed'
    using errcode = '42501'; -- insufficient_privilege
end;
$$ language plpgsql security definer;

create trigger profiles_prevent_role_change
  before update on profiles
  for each row
  execute function prevent_role_change();
