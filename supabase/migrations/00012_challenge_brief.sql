-- Add brief_file_id column to challenges for PDF challenge briefs stored on Google Drive
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS brief_file_id TEXT;
