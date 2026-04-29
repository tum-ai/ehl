-- Default challenge_registration_enabled to true
ALTER TABLE chapters ALTER COLUMN challenge_registration_enabled SET DEFAULT true;
UPDATE chapters SET challenge_registration_enabled = true WHERE challenge_registration_enabled = false;
