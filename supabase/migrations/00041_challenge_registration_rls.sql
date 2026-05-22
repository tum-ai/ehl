-- Tighten challenge registration RLS policies.
--
-- The existing "President manage registrations" policy (00003:211-218) uses
-- FOR ALL with only a team ownership check. A team president could bypass
-- the app-level challenge_registration_enabled check and INSERT directly
-- via the Supabase REST API.
--
-- Fix: split into separate SELECT/INSERT/UPDATE/DELETE policies.
-- Write operations require challenge_registration_enabled = true on the chapter.
-- The admin policy (00003:302) is unchanged: admins can always manage registrations.

drop policy if exists "President manage registrations" on challenge_registrations;

-- President can read their team's registrations (no restriction)
create policy "President read registrations" on challenge_registrations
  for select using (
    exists (
      select 1 from teams
      where teams.id = challenge_registrations.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- President can INSERT only when registration is enabled
create policy "President insert registrations" on challenge_registrations
  for insert with check (
    exists (
      select 1 from teams
      where teams.id = challenge_registrations.team_id
      and teams.president_user_id = auth.uid()
    )
    and exists (
      select 1 from chapters
      where chapters.id = challenge_registrations.chapter_id
      and chapters.challenge_registration_enabled = true
    )
  );

-- President can UPDATE only when registration is enabled
create policy "President update registrations" on challenge_registrations
  for update using (
    exists (
      select 1 from teams
      where teams.id = challenge_registrations.team_id
      and teams.president_user_id = auth.uid()
    )
    and exists (
      select 1 from chapters
      where chapters.id = challenge_registrations.chapter_id
      and chapters.challenge_registration_enabled = true
    )
  );

-- President can DELETE only when registration is enabled
create policy "President delete registrations" on challenge_registrations
  for delete using (
    exists (
      select 1 from teams
      where teams.id = challenge_registrations.team_id
      and teams.president_user_id = auth.uid()
    )
    and exists (
      select 1 from chapters
      where chapters.id = challenge_registrations.chapter_id
      and chapters.challenge_registration_enabled = true
    )
  );
