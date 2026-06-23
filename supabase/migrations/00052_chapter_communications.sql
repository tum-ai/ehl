-- Per-chapter communications: customizable acceptance email + broadcasts + event info.
--
-- Organizers need to share last-minute details (Discord link, venue, schedule) with the
-- accepted participants of a chapter. This migration adds the storage for three features:
--
--   1. A customizable acceptance email: an editable subject line and an optional custom
--      message block. The fixed parts of the acceptance email (QR code, check-in
--      instructions, info table, button) stay hardcoded in the template so check-in can
--      never break; only the subject and an additive message block are admin-controlled.
--   2. A free-text "event info" panel shown in the participant event hub (no email sent).
--   3. A one-off broadcast email to a chapter's applicants, recorded for audit.
--
-- IMPORTANT: the `chapters` table is publicly readable (RLS "Public read chapters":
-- status != 'draft'), and RLS gates ROWS, not COLUMNS. Putting the admin/participant-only
-- text (acceptance email subject/message, event info) directly on `chapters` would let any
-- anon PostgREST caller read it via ?select=<col>. So these fields live in a SEPARATE
-- admin-only table `chapter_communications` (1:1 with a chapter) that has no public read
-- policy at all. event_info reaches participants only through the gated getChapterEventInfo()
-- server action (service_role + application-status check); the email fields are read only by
-- admin-guarded service-role queries. (3) is an append-only log table, also admin-only.

-- 1. Per-chapter communications settings (admin-only). All text nullable: a row with null
--    acceptance_email_subject/message reproduces the legacy hardcoded acceptance email.
create table if not exists chapter_communications (
  chapter_id               uuid primary key references chapters(id) on delete cascade,
  acceptance_email_subject text,
  acceptance_email_message text,
  event_info               text,
  updated_at               timestamptz default now(),
  updated_by               uuid references profiles(id)
);

alter table chapter_communications enable row level security;

-- Admin-only: global admins full access, chapter admins read their own chapter's row.
-- All writes go through createAdminClient() (service_role), which bypasses RLS, so the
-- "for all" policy intentionally has no WITH CHECK (matches application_notes in 00049).
-- There is deliberately NO public/anon read policy, so the text is never exposed publicly.
drop policy if exists "Admin full access chapter_communications" on chapter_communications;
create policy "Admin full access chapter_communications" on chapter_communications
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads own chapter_communications" on chapter_communications;
create policy "Chapter admin reads own chapter_communications" on chapter_communications
  for select using (
    exists (
      select 1
      from chapter_admins ca
      where ca.chapter_id = chapter_communications.chapter_id
        and ca.user_id = auth.uid()
    )
  );

-- 2. Broadcast history: one row per send. Insert-only (no edit/resend/delete in the UI),
--    mirroring the audit intent of application_notes (00049). status_filter records which
--    application statuses were targeted; recipient_count is how many were actually sent.
create table if not exists chapter_broadcasts (
  id              uuid primary key default uuid_generate_v4(),
  chapter_id      uuid not null references chapters(id) on delete cascade,
  subject         text not null,
  body            text not null,
  status_filter   text[] not null,
  sent_by         uuid references profiles(id),
  recipient_count int not null default 0,
  sent_at         timestamptz default now()
);

create index if not exists chapter_broadcasts_chapter_id_idx
  on chapter_broadcasts (chapter_id, sent_at desc);

alter table chapter_broadcasts enable row level security;

-- Same RLS shape as application_notes (00049): global admins have full access, a chapter
-- admin can read broadcasts for their own chapter. All writes go through createAdminClient()
-- (service_role), which bypasses RLS entirely, so the "for all" policy intentionally has no
-- WITH CHECK clause: inserts never travel through a normal authenticated client. (If that
-- ever changes, add a matching WITH CHECK so writes are not silently rejected.)
drop policy if exists "Admin full access chapter_broadcasts" on chapter_broadcasts;
create policy "Admin full access chapter_broadcasts" on chapter_broadcasts
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads broadcasts for own chapter" on chapter_broadcasts;
create policy "Chapter admin reads broadcasts for own chapter" on chapter_broadcasts
  for select using (
    exists (
      select 1
      from chapter_admins ca
      where ca.chapter_id = chapter_broadcasts.chapter_id
        and ca.user_id = auth.uid()
    )
  );
