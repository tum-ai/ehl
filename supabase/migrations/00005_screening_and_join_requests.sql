-- EHL Phase 3: Screening scores, team join requests, email tracking, challenge registration toggle

-- ─── SCREENING SCORES ───────────────────────────────────────
-- Two screeners independently score each application 1-10 (double-blind)

CREATE TABLE screening_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  screener_id UUID NOT NULL REFERENCES profiles(id),
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (application_id, screener_id)
);

CREATE INDEX idx_screening_scores_app ON screening_scores(application_id);

ALTER TABLE screening_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access screening_scores" ON screening_scores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── TEAM JOIN REQUESTS ─────────────────────────────────────
-- At events, participants can request to join a team (president approves)

CREATE TABLE team_join_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  chapter_id UUID NOT NULL REFERENCES chapters(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  UNIQUE (team_id, user_id, chapter_id)
);

CREATE INDEX idx_join_requests_team ON team_join_requests(team_id);
CREATE INDEX idx_join_requests_user ON team_join_requests(user_id);

ALTER TABLE team_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "President manage join requests" ON team_join_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = team_join_requests.team_id
      AND teams.president_user_id = auth.uid()
    )
  );

CREATE POLICY "User read own join requests" ON team_join_requests
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "User create join requests" ON team_join_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin full access join requests" ON team_join_requests
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── CHAPTER: challenge registration toggle ─────────────────

ALTER TABLE chapters ADD COLUMN challenge_registration_enabled BOOLEAN NOT NULL DEFAULT false;

-- ─── APPLICATIONS: email tracking columns ───────────────────
-- Prevent duplicate acceptance/rejection emails

ALTER TABLE applications ADD COLUMN acceptance_email_sent_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN rejection_email_sent_at TIMESTAMPTZ;
