-- Add fork_url column to track EHL's fork of submitted repositories
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fork_url TEXT;
