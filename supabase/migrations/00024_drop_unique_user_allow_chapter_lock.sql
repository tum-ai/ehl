-- Drop the global one-team-per-user constraint.
-- Team locking is now enforced in application logic:
-- a user cannot leave/switch teams while their current team
-- has a challenge_registration for a non-completed chapter.

DROP INDEX IF EXISTS idx_team_members_unique_user;
