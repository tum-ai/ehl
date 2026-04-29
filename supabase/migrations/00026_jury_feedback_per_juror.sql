-- Fix: jury_feedback was keyed on (challenge_id, team_id), meaning
-- the last juror to submit overwrote all previous feedback.
-- Add entered_by column and re-key to (challenge_id, team_id, entered_by).

-- Step 1: Add entered_by column (nullable first for existing rows)
alter table jury_feedback add column entered_by uuid references auth.users(id);

-- Step 2: Drop old primary key
alter table jury_feedback drop constraint jury_feedback_pkey;

-- Step 3: Backfill existing rows with a sentinel value won't work for FK,
-- so delete any existing feedback (pre-launch, no production data to preserve)
delete from jury_feedback where entered_by is null;

-- Step 4: Make entered_by NOT NULL
alter table jury_feedback alter column entered_by set not null;

-- Step 5: New composite primary key
alter table jury_feedback add primary key (challenge_id, team_id, entered_by);

-- Step 6: Update RLS policy for insert (must set entered_by = auth.uid())
drop policy if exists "Jury create feedback" on jury_feedback;
create policy "Jury create feedback" on jury_feedback
  for insert with check (
    entered_by = auth.uid()
    and exists (
      select 1 from jury_assignments
      where jury_assignments.user_id = auth.uid()
      and jury_assignments.challenge_id = jury_feedback.challenge_id
    )
  );

-- Allow jurors to update their own feedback
create policy "Jury update own feedback" on jury_feedback
  for update using (entered_by = auth.uid())
  with check (entered_by = auth.uid());
