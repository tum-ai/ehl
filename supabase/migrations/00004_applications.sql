-- EHL Phase 2: Application System
-- Adds: applications table, applications_open chapter status

-- Add applications_open to chapter_status enum
ALTER TYPE chapter_status ADD VALUE IF NOT EXISTS 'applications_open' BEFORE 'registration_open';

-- Applications table (per-person, per-chapter)
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,

  -- Identity (structured for search/filter)
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,

  -- Status workflow
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'waitlisted', 'checked_in')),

  -- All other form fields (dateOfBirth, gender, nationality, university, etc.)
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- CV file path in Supabase Storage (cvs bucket)
  cv_url text,

  -- Team intent (informational only, does not create/modify teams)
  existing_team_id uuid REFERENCES teams(id),
  team_members jsonb DEFAULT '[]'::jsonb,

  -- QR check-in token (unguessable UUID)
  check_in_token uuid UNIQUE DEFAULT uuid_generate_v4(),
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES profiles(id),

  -- Consent flags (columnar for legal compliance queries)
  consent_attendance boolean NOT NULL DEFAULT false,
  consent_privacy boolean NOT NULL DEFAULT false,
  consent_newsletter boolean DEFAULT false,
  consent_recruiting boolean DEFAULT false,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One application per email per chapter
  UNIQUE (chapter_id, email)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_applications_chapter ON applications(chapter_id);
CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(chapter_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_token ON applications(check_in_token);

-- Row-level security
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin full access on applications"
  ON applications FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Public can read own applications by email
CREATE POLICY "Users read own applications"
  ON applications FOR SELECT
  USING (
    email = (SELECT email FROM profiles WHERE id = auth.uid())
  );
