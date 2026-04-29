-- Dynamic admin email allowlist (replaces hardcoded list)
CREATE TABLE admin_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Domain constraint (configure ADMIN_EMAIL_DOMAIN env var in the application)
-- No DB-level domain constraint: validation happens in application code.

ALTER TABLE admin_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access admin_emails" ON admin_emails
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Seed with initial admin (replace with your org's admin email)
INSERT INTO admin_emails (email) VALUES
  ('admin@example.com')
ON CONFLICT (email) DO NOTHING;
