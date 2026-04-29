-- Registration refactor: solo registration, team invites, TUM.ai verification
-- Adds: tumai_members table, team_invites table, profiles.looking_for_team, teams.looking_for_members

-- ─── TUM.ai Members (CSV upload by admin) ──────────────────
CREATE TABLE tumai_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES profiles(id)
);

ALTER TABLE tumai_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access tumai_members" ON tumai_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── Team Invites ──────────────────────────────────────────
CREATE TABLE team_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  token UUID UNIQUE DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  UNIQUE (team_id, email)
);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

-- President of the team can manage invites
CREATE POLICY "President manage own team invites" ON team_invites
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = team_invites.team_id
      AND teams.president_user_id = auth.uid()
    )
  );

-- Users can see invites sent to their email
CREATE POLICY "Users view own invites" ON team_invites
  FOR SELECT USING (
    email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

-- Admin full access
CREATE POLICY "Admin full access team_invites" ON team_invites
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── Profile: looking for team flag ────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS looking_for_team BOOLEAN DEFAULT false;

-- ─── Teams: looking for members flag ───────────────────────
ALTER TABLE teams ADD COLUMN IF NOT EXISTS looking_for_members BOOLEAN DEFAULT false;

-- ─── Allow solo_registration type in verification_codes ───
ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_type_check;
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_type_check
  CHECK (type = ANY (ARRAY['registration'::text, 'member_confirm'::text, 'solo_registration'::text]));

-- ─── Add screening status and deadline columns ───────────
ALTER TYPE chapter_status ADD VALUE IF NOT EXISTS 'screening' AFTER 'applications_open';
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS application_deadline TIMESTAMPTZ;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS challenge_selection_deadline TIMESTAMPTZ;

-- ─── Make chapter_id nullable in team_join_requests (dashboard requests) ───
ALTER TABLE team_join_requests ALTER COLUMN chapter_id DROP NOT NULL;
ALTER TABLE team_join_requests DROP CONSTRAINT IF EXISTS team_join_requests_team_id_user_id_chapter_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_unique
  ON team_join_requests (team_id, user_id, COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'));
