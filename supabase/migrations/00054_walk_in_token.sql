-- Per-chapter walk-in registration token.
--
-- At an event, no-show spots are filled by walk-ins who scan a per-chapter QR,
-- fill the application form on their phone AND create an account in one step,
-- and become auto-accepted full league participants. The QR encodes an
-- unguessable per-chapter token. Anyone holding the token can register a
-- walk-in for that chapter, so the token must be treated as a secret.
--
-- IMPORTANT (same reasoning as 00052_chapter_communications): the `chapters`
-- table is publicly readable (RLS "Public read chapters": status != 'draft'),
-- and RLS gates ROWS, not COLUMNS. Putting `walk_in_token` directly on
-- `chapters` would let any anon PostgREST caller read it via ?select=walk_in_token
-- and walk in to any chapter. So the token lives in a SEPARATE admin-only table
-- `chapter_walk_in` (1:1 with a chapter) that has NO public read policy at all.
-- The token reaches the public walk-in page only through the gated
-- getWalkInChapterByToken() server action (service_role), which looks a chapter
-- up BY token and never exposes the token list. This mirrors the precedent set
-- by chapter_communications in 00052.

create table if not exists chapter_walk_in (
  chapter_id     uuid primary key references chapters(id) on delete cascade,
  walk_in_token  uuid not null default uuid_generate_v4(),
  rotated_at     timestamptz default now(),
  rotated_by     uuid references profiles(id)
);

-- The token is looked up by value on every walk-in page hit, and must be globally
-- unique so a lookup resolves to exactly one chapter.
create unique index if not exists chapter_walk_in_token_unique
  on chapter_walk_in (walk_in_token);

alter table chapter_walk_in enable row level security;

-- Admin-only, same RLS shape as chapter_communications (00052): global admins
-- have full access, a chapter admin reads their own chapter's row. All writes go
-- through createAdminClient() (service_role), which bypasses RLS, so the "for all"
-- policy intentionally has no WITH CHECK. There is deliberately NO public/anon
-- read policy, so the token is never exposed publicly.
drop policy if exists "Admin full access chapter_walk_in" on chapter_walk_in;
create policy "Admin full access chapter_walk_in" on chapter_walk_in
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads own chapter_walk_in" on chapter_walk_in;
create policy "Chapter admin reads own chapter_walk_in" on chapter_walk_in
  for select using (
    exists (
      select 1
      from chapter_admins ca
      where ca.chapter_id = chapter_walk_in.chapter_id
        and ca.user_id = auth.uid()
    )
  );
