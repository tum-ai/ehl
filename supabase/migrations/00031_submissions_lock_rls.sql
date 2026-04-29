-- Fix F-03: Enforce submission lock at RLS level, not just application code.
--
-- The "President manage submissions" policy (00003:221-228) allows a
-- team president to INSERT/UPDATE/DELETE submissions with no deadline
-- check. A motivated participant could bypass the application-level
-- deadline check by sending requests directly to the Supabase REST API.
--
-- Fix: Replace the policy with separate INSERT and UPDATE policies that
-- check is_locked = false. This prevents writes to locked submissions
-- regardless of whether the request comes through the app or the REST API.
-- The SELECT portion is handled by "Public read own submissions" policy.
-- DELETE is intentionally not re-created (submissions should not be
-- deleted by participants).

-- Drop the old combined policy
drop policy if exists "President manage submissions" on submissions;

-- Presidents can INSERT new submissions only if not locked
create policy "President insert submissions" on submissions
  for insert with check (
    not is_locked
    and exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- Presidents can UPDATE their submissions only if not locked
create policy "President update submissions" on submissions
  for update using (
    not is_locked
    and exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
  );
