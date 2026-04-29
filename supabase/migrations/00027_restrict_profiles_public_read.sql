-- F02 fix: Restrict profiles table from public-read to authenticated-read.
-- Previously: anyone with the anon key could SELECT all profiles including emails.
-- Now: only authenticated users can read profiles (own profile always visible,
-- teammates visible, admins can see all).
-- Public pages (team/[slug]) use server-side adminClient queries that bypass RLS.

-- Drop the overly permissive public read policy
drop policy if exists "Public read profiles" on profiles;

-- Authenticated users can read their own profile
create policy "Users read own profile" on profiles
  for select using (auth.uid() = id);

-- Authenticated users can read their teammates' profiles
create policy "Users read teammate profiles" on profiles
  for select using (
    id in (
      select tm2.user_id from team_members tm1
      join team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.user_id = auth.uid()
    )
  );

-- Admins can read all profiles
create policy "Admins read all profiles" on profiles
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Jury can read profiles of teams they're evaluating
create policy "Jury read assigned profiles" on profiles
  for select using (
    exists (
      select 1 from jury_assignments ja
      join challenge_registrations cr on cr.challenge_id = ja.challenge_id
      join team_members tm on tm.team_id = cr.team_id
      where ja.user_id = auth.uid()
        and tm.user_id = profiles.id
    )
  );
