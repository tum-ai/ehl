-- App-wide settings (API keys, tokens, config)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

-- RLS: admin only
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on app_settings"
  ON app_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_emails ae
      JOIN profiles p ON p.email = ae.email
      JOIN auth.users u ON u.id = p.id
      WHERE u.id = auth.uid()
    )
  );
