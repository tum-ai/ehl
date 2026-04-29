-- EHL Phase 1 Schema
-- Tables: chapters, teams, scores, partners, media
-- Full schema (challenges, submissions, jury, etc.) added in Phase 2

create extension if not exists "uuid-ossp";

-- ─── ENUM TYPES ─────────────────────────────────────────────
create type chapter_status as enum (
  'draft', 'announced', 'registration_open',
  'hacking', 'submissions_open', 'pitching', 'completed'
);

create type partner_tier as enum ('challenge', 'tech', 'title', 'gold', 'silver', 'chapter_host');
create type media_type as enum ('photo', 'video', 'aftermovie', 'short');
create type user_role as enum ('participant', 'jury', 'admin');

-- ─── PROFILES ───────────────────────────────────────────────
-- Extends Supabase auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text unique,
  role user_role default 'participant',
  created_at timestamptz default now()
);

-- ─── TEAMS ──────────────────────────────────────────────────
create table teams (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  logo_url text,
  university text,
  city text,
  status text default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz default now()
);

-- ─── CHAPTERS ───────────────────────────────────────────────
create table chapters (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  city text not null,
  country text not null,
  country_code text not null default '',
  date date,
  status chapter_status default 'draft',
  description text,
  hero_image_url text,
  match_number int not null,
  is_finale boolean default false,
  created_at timestamptz default now()
);

-- ─── SCORES ─────────────────────────────────────────────────
create table scores (
  chapter_id uuid references chapters(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  challenge_name text,
  placement int check (placement between 1 and 5),
  points int not null default 0,
  published boolean default false,
  published_at timestamptz,
  primary key (chapter_id, team_id)
);

-- ─── PARTNERS ───────────────────────────────────────────────
create table partners (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  logo_url text,
  url text,
  tier partner_tier not null,
  description text,
  display_order int default 0,
  active boolean default true,
  chapter_id uuid references chapters(id)
);

-- ─── MEDIA ──────────────────────────────────────────────────
create table media (
  id uuid primary key default uuid_generate_v4(),
  type media_type not null,
  url text not null,
  thumbnail_url text,
  chapter_id uuid references chapters(id),
  caption text,
  featured boolean default false,
  uploaded_at timestamptz default now()
);

-- ─── LEADERBOARD VIEW ───────────────────────────────────────
create or replace view leaderboard as
select
  t.id as team_id,
  t.name as team_name,
  t.slug as team_slug,
  t.logo_url,
  t.university,
  t.city as origin,
  coalesce(sum(s.points) filter (where s.published), 0) as total_points,
  count(s.chapter_id) filter (where s.published) as matches_played,
  min(s.placement) filter (where s.published and s.placement is not null) as best_finish,
  rank() over (
    order by
      coalesce(sum(s.points) filter (where s.published), 0) desc,
      min(s.placement) filter (where s.published and s.placement is not null) asc nulls last
  ) as rank
from teams t
left join scores s on t.id = s.team_id
where t.status = 'active'
group by t.id, t.name, t.slug, t.logo_url, t.university, t.city;

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
alter table profiles enable row level security;
alter table teams enable row level security;
alter table chapters enable row level security;
alter table scores enable row level security;
alter table partners enable row level security;
alter table media enable row level security;

-- Public read policies
create policy "Public read teams" on teams
  for select using (status = 'active');

create policy "Public read chapters" on chapters
  for select using (status != 'draft');

create policy "Public read published scores" on scores
  for select using (published = true);

create policy "Public read active partners" on partners
  for select using (active = true);

create policy "Public read media" on media
  for select using (true);

create policy "Public read profiles" on profiles
  for select using (true);

-- Admin full access
create policy "Admin full access profiles" on profiles
  for all using (
    auth.uid() = id
    or (auth.jwt() ->> 'role' = 'service_role')
  );

create policy "Admin full access teams" on teams
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access chapters" on chapters
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access scores" on scores
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access partners" on partners
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access media" on media
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
