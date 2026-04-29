-- Security hardening migration: fixes F-02, F-03, F-10 from security review.
--
-- F-02: Add DB-level trigger to prevent multi-team membership during active chapters.
-- F-03: Restrict team_members SELECT to authenticated users only.
-- F-10: Add real-time deadline check to submission RLS policies.


-- ═══════════════════════════════════════════════════════════════
-- F-02: Team membership race condition prevention
-- ═══════════════════════════════════════════════════════════════
-- Migration 00024 dropped the global unique index on team_members(user_id)
-- to allow roster changes between chapters. The application-level check
-- (getChapterLockError) has a TOCTOU race window: two concurrent requests
-- can both pass the check and insert, putting a user on two teams during
-- an active chapter.
--
-- This trigger serializes inserts for the same user_id via FOR UPDATE
-- and atomically checks for active chapter registrations.

create or replace function check_team_member_chapter_lock()
returns trigger as $$
begin
  -- Lock the user's existing team_members rows to serialize concurrent inserts.
  -- This prevents two concurrent acceptTeamInvite() calls from both passing.
  perform 1
  from team_members tm
  where tm.user_id = NEW.user_id
    and tm.team_id != NEW.team_id
  for update;

  -- Check if user is already on a team registered for a non-completed chapter.
  if exists (
    select 1
    from team_members tm
    join challenge_registrations cr on cr.team_id = tm.team_id
    join chapters ch on ch.id = cr.chapter_id
    where tm.user_id = NEW.user_id
      and tm.team_id != NEW.team_id
      and ch.status != 'completed'
  ) then
    raise exception 'User is locked to their current team during an active chapter'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$ language plpgsql;

create trigger trg_team_member_chapter_lock
  before insert on team_members
  for each row
  execute function check_team_member_chapter_lock();


-- ═══════════════════════════════════════════════════════════════
-- F-03: Restrict team_members read access to authenticated users
-- ═══════════════════════════════════════════════════════════════
-- The old policy "Public read team members" (00003:187) used using(true),
-- allowing unauthenticated REST API callers to enumerate all user-team
-- relationships. Restricting to authenticated users prevents anonymous
-- enumeration while keeping data accessible for server-side rendering
-- (which uses the admin client, bypassing RLS).

drop policy if exists "Public read team members" on team_members;

create policy "Authenticated read team members" on team_members
  for select using (auth.uid() is not null);


-- ═══════════════════════════════════════════════════════════════
-- F-10: Real-time deadline check on submission RLS policies
-- ═══════════════════════════════════════════════════════════════
-- Migration 00031 checks "not is_locked" but is_locked is set by the
-- daily cron job. Between deadline expiry and cron execution, a user
-- bypassing the app could write submissions via the REST API.
--
-- Fix: add a real-time deadline check that joins through
-- submissions -> challenges -> chapters to verify submission_deadline.
-- COALESCE with 'infinity' handles chapters with no deadline set.

drop policy if exists "President insert submissions" on submissions;
drop policy if exists "President update submissions" on submissions;

create policy "President insert submissions" on submissions
  for insert with check (
    not is_locked
    and exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
    and coalesce(
      (select ch.submission_deadline
       from challenges c
       join chapters ch on ch.id = c.chapter_id
       where c.id = submissions.challenge_id),
      'infinity'::timestamptz
    ) > now()
  );

create policy "President update submissions" on submissions
  for update using (
    not is_locked
    and exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
    and coalesce(
      (select ch.submission_deadline
       from challenges c
       join chapters ch on ch.id = c.chapter_id
       where c.id = submissions.challenge_id),
      'infinity'::timestamptz
    ) > now()
  );
