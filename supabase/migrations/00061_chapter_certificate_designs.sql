-- Per-chapter custom certificate background designs (certificates v2, Stage 1).
--
-- Admins can upload one full-page background image per chapter and per
-- certificate variant (participation / achievement), e.g. carrying sponsor
-- branding. The certificate PDF route draws the image full-bleed and lays the
-- text on top at fixed positions (lib/certificates/layout.ts). No upload =>
-- default EHL design (fallback, zero regression).
--
-- The image itself lives in the PRIVATE Supabase Storage bucket
-- `certificate-backgrounds` (created lazily on first upload); this table only
-- records which chapter+variant has a design and where it is stored.
--
-- IMPORTANT (same reasoning as 00052 / 00054 / 00060): `chapters` is publicly
-- readable and RLS gates ROWS, not COLUMNS, so per-chapter admin-only state
-- lives in a SEPARATE table with no public read policy, never as columns on
-- `chapters`. Designs may reveal sponsor branding before an event is public.
--
-- uploaded_by is ON DELETE SET NULL: a restricting FK to profiles would make
-- any admin who ever uploaded a design undeletable (the auth.users -> profiles
-- cascade aborts on a restricting FK). That bug shipped on event_log.actor_id
-- (fixed in 00058) and on chapter_walk_in.rotated_by (fixed in 00060) — don't
-- reintroduce it here.
create table if not exists chapter_certificate_designs (
  chapter_id   uuid not null references chapters(id) on delete cascade,
  variant      text not null check (variant in ('participation', 'achievement')),
  storage_path text not null,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (chapter_id, variant)
);

alter table chapter_certificate_designs enable row level security;

-- Global-admin-only (certificate designs are chapter settings, which local
-- chapter admins cannot edit). All server access goes through
-- createAdminClient() (service_role), which bypasses RLS; this policy exists so
-- a future authenticated read path stays admin-scoped. There is deliberately NO
-- public/anon read policy.
drop policy if exists "Admin full access chapter_certificate_designs" on chapter_certificate_designs;
create policy "Admin full access chapter_certificate_designs" on chapter_certificate_designs
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
