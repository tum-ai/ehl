-- Add "queued" to code_reviews status constraint
-- and ensure unique submission_id for upsert support

ALTER TABLE code_reviews DROP CONSTRAINT IF EXISTS code_reviews_status_check;
ALTER TABLE code_reviews ADD CONSTRAINT code_reviews_status_check
  CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed'));

-- Unique constraint on submission_id (one review per submission)
ALTER TABLE code_reviews ADD CONSTRAINT code_reviews_submission_id_unique
  UNIQUE (submission_id);
