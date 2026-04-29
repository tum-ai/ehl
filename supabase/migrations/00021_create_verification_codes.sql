-- Create verification_codes table (was missing from migration history)
-- This table is used for email verification during registration flows.

CREATE TABLE IF NOT EXISTS verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  CONSTRAINT verification_codes_type_check
    CHECK (type IN ('registration', 'member_confirm', 'solo_registration'))
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_email_code
  ON verification_codes (email, code);
