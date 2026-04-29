-- Prevent a user from being a member of multiple teams simultaneously.
-- The PK is (team_id, user_id) which allows the same user in different teams.
-- This unique constraint enforces one-team-per-user at the database level.

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_unique_user
  ON team_members (user_id);
