-- Season leaderboard: loyalty bonus, and no best-finish tiebreaker.
--
-- 1. Teams on equal total points now share a rank. 00038 ranked by points and
--    then by best single-match finish, so equal-point teams got different ranks.
--    sort_name stays as the display order inside a tie; it never affects rank.
-- 2. Loyalty bonus points (the Rules page: +6 for the same roster across 3
--    matches in 2+ countries, +10 for the full season) are awarded by hand, one
--    row per team, and added to total_points. Eligibility is decided by the
--    organizers, not computed here.
--
-- No existing data changes: scores are untouched, the new table starts empty.

create table if not exists loyalty_bonuses (
  team_id uuid primary key references teams(id) on delete cascade,
  points integer not null check (points > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

comment on table loyalty_bonuses is
  'Season loyalty bonus per team, added to leaderboard.total_points. Admin-managed.';

-- No policies: only the service role (admin client) reads or writes it. The
-- leaderboard view runs with its owner's rights, so the public still sees the
-- bonus through the view.
alter table loyalty_bonuses enable row level security;

-- CREATE OR REPLACE VIEW keeps the existing columns in order; loyalty_bonus is
-- appended at the end. team_id is the primary key of loyalty_bonuses, so the
-- join adds at most one row per team and cannot multiply the score sums.
create or replace view leaderboard as
select
  t.id as team_id,
  t.name as team_name,
  t.slug as team_slug,
  t.logo_url,
  t.university,
  t.city as origin,
  coalesce(sum(s.points) filter (where s.published), 0) + coalesce(lb.points, 0) as total_points,
  count(s.chapter_id) filter (where s.published) as matches_played,
  min(s.placement) filter (where s.published and s.placement is not null) as best_finish,
  rank() over (
    order by coalesce(sum(s.points) filter (where s.published), 0) + coalesce(lb.points, 0) desc
  ) as rank,
  t.name as sort_name,
  coalesce(lb.points, 0) as loyalty_bonus
from teams t
left join scores s on t.id = s.team_id
left join loyalty_bonuses lb on lb.team_id = t.id
where t.status = 'active'
group by t.id, t.name, t.slug, t.logo_url, t.university, t.city, lb.points;
