-- Optional per-challenge team capacity. NULL means unlimited (default,
-- backward compatible with every existing challenge). When set, registration
-- actions reject new signups once challenge_registrations for the challenge
-- reaches this count (first come, first served; no waitlist yet).
alter table challenges
  add column if not exists max_teams integer;

alter table challenges
  add constraint challenges_max_teams_positive
  check (max_teams is null or max_teams > 0);
