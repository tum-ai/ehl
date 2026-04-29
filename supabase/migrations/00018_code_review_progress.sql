-- Add progress column for live pipeline status tracking
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS progress text;
