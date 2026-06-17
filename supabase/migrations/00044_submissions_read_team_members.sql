-- Reconcile submissions read policy to match production behavior.
--
-- Drift reconciliation (toward prod): production allows ANY team member to read
-- their team's submission, via a "Team members read own submissions" policy that
-- was applied out-of-band and exists in no prior migration. The repo's 00003
-- shipped "Public read own submissions" (president-only read). Production's
-- any-member behavior is the intended UX (team members should see their own
-- team's submission), so this migration makes the repo match production rather
-- than restricting members at the event.
--
-- Net effect: replace the president-only SELECT policy with a team-member SELECT
-- policy. Idempotent (DROP IF EXISTS for both names).

DROP POLICY IF EXISTS "Public read own submissions" ON submissions;
DROP POLICY IF EXISTS "Team members read own submissions" ON submissions;

CREATE POLICY "Team members read own submissions" ON submissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = submissions.team_id
        AND team_members.user_id = auth.uid()
    )
  );
