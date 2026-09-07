-- Post-acceptance RSVP (statistics only)
--
-- Between acceptance and event day nothing tells us who actually intends to
-- show up, so headcount and catering are guesswork until check-in. An admin
-- presses one button, every accepted applicant gets a standalone email with a
-- "Confirm attendance" / "Can't make it" link, and the answer is logged here.
--
-- This is DELIBERATELY decoupled from the application workflow: it never reads
-- or writes applications.status, it is not part of the acceptance email, and
-- removing the feature is a single `drop table`. Nothing downstream (check-in,
-- teams, registration) consults it.
--
-- Why a SEPARATE table rather than rsvp_* columns on applications: applications
-- carries a "Users read own applications" SELECT policy (00004), and RLS gates
-- ROWS, not COLUMNS. An rsvp_token column would therefore be readable by the
-- applicant's own session via ?select=rsvp_token. Same reasoning that put
-- walk_in_token in its own table (00054). This table has NO anon policy and NO
-- "user reads own" policy at all; the token reaches the applicant only through
-- the emailed link, and is resolved server-side by getRsvpByToken().
--
-- A row exists only once someone has been ASKED, so "already emailed" is simply
-- "row exists" and pressing the send button twice is safe. `response` stays null
-- until they answer; the first answer wins (the action updates WHERE response IS
-- NULL, so the lock is enforced by the database, not by a read-then-write gap).

create table if not exists application_rsvps (
  application_id uuid primary key references applications(id) on delete cascade,
  rsvp_token     uuid not null default uuid_generate_v4(),
  response       text check (response in ('yes', 'no')),
  responded_at   timestamptz,
  email_sent_at  timestamptz not null default now()
);

-- The token is looked up by value on every RSVP page hit, and must be globally
-- unique so a lookup resolves to exactly one application.
create unique index if not exists application_rsvps_token_unique
  on application_rsvps (rsvp_token);

-- The admin panel counts confirmed / declined / awaiting per chapter.
create index if not exists application_rsvps_response
  on application_rsvps (response);

alter table application_rsvps enable row level security;

-- Admin-only, same RLS shape as chapter_walk_in (00054): global admins have full
-- access, a chapter admin reads the rows of their own chapter's applications.
-- All writes go through createAdminClient() (service_role), which bypasses RLS,
-- so the "for all" policy intentionally has no WITH CHECK. There is deliberately
-- NO public/anon read policy and no applicant self-read policy, so the token is
-- never exposed by PostgREST to anyone.
drop policy if exists "Admin full access application_rsvps" on application_rsvps;
create policy "Admin full access application_rsvps" on application_rsvps
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads own application_rsvps" on application_rsvps;
create policy "Chapter admin reads own application_rsvps" on application_rsvps
  for select using (
    exists (
      select 1
      from applications a
      join chapter_admins ca on ca.chapter_id = a.chapter_id
      where a.id = application_rsvps.application_id
        and ca.user_id = auth.uid()
    )
  );
