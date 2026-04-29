-- Add attempt tracking to verification_codes to prevent brute-force attacks
ALTER TABLE verification_codes
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
