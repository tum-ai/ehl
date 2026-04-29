-- Fix: allow deleting teams even if referenced by applications
-- The existing_team_id is an optional reference, safe to null out on team deletion
ALTER TABLE applications
  DROP CONSTRAINT applications_existing_team_id_fkey,
  ADD CONSTRAINT applications_existing_team_id_fkey
    FOREIGN KEY (existing_team_id) REFERENCES teams(id) ON DELETE SET NULL;
