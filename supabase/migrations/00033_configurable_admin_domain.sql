-- Ensure no hardcoded domain constraint exists on admin_emails.
-- Domain validation is handled in application code via ADMIN_EMAIL_DOMAIN env var.
ALTER TABLE admin_emails DROP CONSTRAINT IF EXISTS admin_email_domain;
