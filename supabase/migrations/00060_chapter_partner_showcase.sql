-- Per-chapter partner (sponsor) showcase access token + settings.
--
-- After a match, sponsors want to browse that chapter's applicants (name,
-- LinkedIn, GitHub), view/download their CVs, see who actually participated,
-- the teams, the final ranking, and event photos. We share this via an
-- unguessable per-chapter link (no login), exactly like the walk-in token
-- (00054): anyone holding the token can view the showcase for that chapter, so
-- the token is a secret.
--
-- IMPORTANT (same reasoning as 00052_chapter_communications and 00054_walk_in):
-- the `chapters` table is publicly readable (RLS "Public read chapters":
-- status != 'draft') and RLS gates ROWS, not COLUMNS. Putting `showcase_token`
-- directly on `chapters` would let any anon PostgREST caller read it via
-- ?select=showcase_token and open any chapter's showcase. So the token lives in
-- a SEPARATE admin-only table `chapter_partner_showcase` (1:1 with a chapter)
-- that has NO public read policy at all. The token reaches the public showcase
-- page only through the gated getShowcaseByToken() server action (service_role),
-- which looks a chapter up BY token and never exposes the token list.
--
-- Beyond the token, this table carries per-chapter settings so an admin controls
-- exactly what a sponsor sees, and the link can expire:
--   is_enabled  -- master switch; a showcase is off until an admin turns it on
--   show_cvs    -- whether CV view/download is offered (off by default: CVs are
--                  the most sensitive artifact, opt-in per chapter)
--   expires_at  -- optional hard expiry; a sponsor handoff should not stay live
--                  forever. NULL = no expiry.
-- The consent/status filtering of WHICH applicants appear is enforced in the
-- query layer (consent_sponsor_data OR consent_recruiting), not here.

-- rotated_by is ON DELETE SET NULL: a plain FK to profiles would make any user
-- who ever rotated a token undeletable (the auth.users -> profiles cascade
-- aborts on a restricting FK). That exact bug shipped once already on
-- event_log.actor_id and was fixed in 00058 — don't reintroduce it here.
create table if not exists chapter_partner_showcase (
  chapter_id      uuid primary key references chapters(id) on delete cascade,
  showcase_token  uuid not null default uuid_generate_v4(),
  is_enabled      boolean not null default false,
  show_cvs        boolean not null default false,
  expires_at      timestamptz,
  rotated_at      timestamptz default now(),
  rotated_by      uuid references profiles(id) on delete set null
);

-- Retrofit the same fix onto chapter_walk_in (00054), which shipped with the
-- pre-00058 gap: its rotated_by FK had no ON DELETE clause, so a chapter admin
-- who rotated a walk-in token (and was later downgraded to participant) could
-- not be GDPR-deleted. Same remedy as 00058: SET NULL keeps the row, drops the
-- person.
alter table chapter_walk_in
  drop constraint if exists chapter_walk_in_rotated_by_fkey;
alter table chapter_walk_in
  add constraint chapter_walk_in_rotated_by_fkey
  foreign key (rotated_by) references profiles(id) on delete set null;

-- The token is looked up by value on every showcase page hit, and must be
-- globally unique so a lookup resolves to exactly one chapter.
create unique index if not exists chapter_partner_showcase_token_unique
  on chapter_partner_showcase (showcase_token);

alter table chapter_partner_showcase enable row level security;

-- Admin-only, same RLS shape as chapter_walk_in (00054): global admins have full
-- access, a chapter admin reads their own chapter's row. All writes go through
-- createAdminClient() (service_role), which bypasses RLS, so the "for all" policy
-- intentionally has no WITH CHECK. There is deliberately NO public/anon read
-- policy, so the token is never exposed publicly.
drop policy if exists "Admin full access chapter_partner_showcase" on chapter_partner_showcase;
create policy "Admin full access chapter_partner_showcase" on chapter_partner_showcase
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Chapter admin reads own chapter_partner_showcase" on chapter_partner_showcase;
create policy "Chapter admin reads own chapter_partner_showcase" on chapter_partner_showcase
  for select using (
    exists (
      select 1
      from chapter_admins ca
      where ca.chapter_id = chapter_partner_showcase.chapter_id
        and ca.user_id = auth.uid()
    )
  );
