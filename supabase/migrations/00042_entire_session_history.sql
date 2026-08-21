-- Entire.io session-history integration
--
-- Adds a per-challenge toggle (like code_review_enabled) and a storage slot for
-- the session-history analysis produced by the code-review pipeline.
--
-- Design: when entire_required is on, submissions must carry an Entire session
-- record (the legacy branch or a ref-based checkpoint with at least one captured prompt).
-- Presence is a hard gate at submission time; the QUALITY of that history is an
-- advisory bonus surfaced to the jury and never feeds placement/scoring.

-- Per-challenge toggle: require an Entire session record to submit. Off by
-- default so existing challenges are unaffected. Can be turned off per challenge
-- exactly like code_review_enabled / invite_jury_to_forks.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS entire_required BOOLEAN DEFAULT false;

-- Stores the SessionHistoryAnalysis produced by the pipeline's session-history
-- sub-reviewer (process-quality bonus + completeness/tamper plausibility).
-- Advisory only; informational for the jury.
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS session_history JSONB;
