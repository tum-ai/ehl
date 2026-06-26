-- Code-review queue observability: track when a review was queued so the admin
-- UI can detect "queued long ago, nothing happened" (a worker that was never
-- triggered or never picked up the row) instead of showing a permanent, silent
-- "Queued" with no explanation.
--
-- generated_at exists but is overwritten on completion and reused as a sort key,
-- so it cannot reliably mean "queued at". A dedicated column is unambiguous.
--
-- The last dispatch OUTCOME (ok / message / timestamp) is stored separately in
-- app_settings under key 'code_review_last_dispatch' (a single JSON value, since
-- one repository_dispatch covers the whole queue) so it persists across reloads
-- and is shown durably in the admin UI. No schema change needed for that.

ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
