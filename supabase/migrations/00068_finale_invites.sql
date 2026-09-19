-- Grand Finale invites: "I'm in" is the application
--
-- Only the top league teams may join the Finale, and making them fill in the
-- public application form again is pointless: the organizers already decided
-- they are in. Every current member of a qualifying team gets a personal
-- emailed link with two buttons. "I'm in" creates an ACCEPTED application for
-- the Finale chapter (so the existing QR check-in flow works unchanged) and
-- triggers the normal acceptance email. "I'm out" is recorded and nothing else
-- happens.
--
-- Why a SEPARATE table rather than columns on applications: identical reasoning
-- to application_rsvps (00065) and chapter_walk_in (00054). An invite exists
-- BEFORE any application does (that is the whole point), and applications
-- carries a "Users read own applications" SELECT policy while RLS gates ROWS,
-- not COLUMNS, so an invite_token column would be readable by the invitee's own
-- session via ?select=invite_token. This table has NO anon policy and no
-- "user reads own" policy at all; the token reaches the person only through the
-- emailed link and is resolved server-side by getFinaleInviteByToken().
--
-- A row exists only once someone has been INVITED, so "already emailed" is
-- simply "row exists" and pressing the send button twice is safe. `response`
-- stays null until they answer; the first answer wins (the action updates
-- WHERE response IS NULL, so the lock is enforced by the database, not by a
-- read-then-write gap), mirroring application_rsvps.

create table if not exists finale_invites (
  id             uuid primary key default uuid_generate_v4(),
  chapter_id     uuid not null references chapters(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  email          text not null,
  invite_token   uuid not null default uuid_generate_v4(),
  response       text check (response in ('yes', 'no')),
  responded_at   timestamptz,
  -- Set when a "yes" created (or promoted) the Finale application, so the admin
  -- board can join straight to it. Null for "no" and for unanswered invites.
  -- ON DELETE SET NULL: deleting an application must not delete the record that
  -- the person was invited and answered.
  application_id uuid references applications(id) on delete set null,
  email_sent_at  timestamptz not null default now(),
  -- One invite per person per chapter. A person on two qualifying teams is
  -- invited once (the send picks their first team), so they cannot answer twice
  -- and cannot receive two mails.
  unique (chapter_id, user_id)
);

-- The token is looked up by value on every invite page hit, and must be
-- globally unique so a lookup resolves to exactly one invite.
create unique index if not exists finale_invites_token_unique
  on finale_invites (invite_token);

-- The admin board counts in / out / awaiting per chapter and lists per team.
create index if not exists finale_invites_chapter_team
  on finale_invites (chapter_id, team_id);

alter table finale_invites enable row level security;

-- Admin-only, same RLS shape as application_rsvps (00065): global admins have
-- full access, a chapter admin reads their own chapter's rows. All writes go
-- through createAdminClient() (service_role), which bypasses RLS, so the
-- "for all" policy intentionally has no WITH CHECK. There is deliberately NO
-- public/anon read policy and no invitee self-read policy, so the token is
-- never exposed by PostgREST to anyone.
drop policy if exists "Admin full access finale_invites" on finale_invites;
create policy "Admin full access finale_invites" on finale_invites
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads own finale_invites" on finale_invites;
create policy "Chapter admin reads own finale_invites" on finale_invites
  for select using (
    exists (
      select 1 from chapter_admins ca
      where ca.chapter_id = finale_invites.chapter_id
        and ca.user_id = auth.uid()
    )
  );
