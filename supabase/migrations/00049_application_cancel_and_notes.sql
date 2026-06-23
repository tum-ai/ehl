-- Cancel an accepted applicant + admin notes history.
--
-- An applicant who was already accepted (and possibly emailed) can withdraw or
-- otherwise become unable to attend. A hard delete would lose the record and the
-- reason, so we add a soft "cancelled" status that keeps the row visible, plus an
-- append-only notes table for the version history admins asked for.
--
-- The existing immutable event_log (00036_event_log.sql) records the cancel
-- transition with a hash chain; application_notes holds the free-text thread
-- (the cancel reason is written as the first note). Cancellation is terminal:
-- there is no uncancel/reversal path.

-- 1. Allow the new "cancelled" status. Drop the old CHECK and recreate it with
--    the extra value (Postgres has no ALTER ... ADD VALUE for CHECK constraints).
alter table applications
  drop constraint if exists applications_status_check;

alter table applications
  add constraint applications_status_check
  check (status in ('pending', 'accepted', 'rejected', 'waitlisted', 'checked_in', 'cancelled'));

-- 2. Cancellation metadata on the application itself, mirroring the
--    *_email_sent_at columns: nullable, only set when a cancel happens.
alter table applications
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references profiles(id),
  add column if not exists cancel_reason text;

-- 3. Append-only admin notes ("Versionierungshistorie" with free-text notes).
--    Notes are never edited or deleted in the UI; the cancel reason is recorded
--    as the first note and admins can append further notes over time.
create table if not exists application_notes (
  id             uuid primary key default uuid_generate_v4(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id      uuid references profiles(id),
  author_email   text,
  body           text not null,
  created_at     timestamptz default now()
);

create index if not exists application_notes_application_id_idx
  on application_notes (application_id, created_at);

alter table application_notes enable row level security;

-- Same RLS shape as chapter_admins (00046): a chapter admin can read notes for
-- applications in their chapter, global admins have full access. All writes go
-- through createAdminClient() (service_role), which bypasses RLS entirely, so
-- this "for all" policy intentionally has no WITH CHECK clause: inserts/updates
-- never travel through a normal authenticated client. (If that ever changes, add
-- a matching WITH CHECK so writes are not silently rejected.)
drop policy if exists "Admin full access application_notes" on application_notes;
create policy "Admin full access application_notes" on application_notes
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads notes for own chapter" on application_notes;
create policy "Chapter admin reads notes for own chapter" on application_notes
  for select using (
    exists (
      select 1
      from applications a
      join chapter_admins ca on ca.chapter_id = a.chapter_id
      where a.id = application_notes.application_id
        and ca.user_id = auth.uid()
    )
  );
