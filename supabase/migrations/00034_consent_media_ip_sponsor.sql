-- Add GDPR consent fields for media usage, IP transfer, and sponsor data sharing
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_media boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_ip_transfer boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_sponsor_data boolean DEFAULT false;
