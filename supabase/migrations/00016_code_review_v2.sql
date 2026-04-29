-- AI Code Review v2: Multi-agent pipeline with per-challenge config

-- New field: Custom instructions for the AI reviewer
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS code_review_instructions TEXT;

-- New field: Review configuration (models, weights, language, token budget)
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS code_review_config JSONB DEFAULT '{}'::jsonb;

-- Extend code_reviews table
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS repo_metadata JSONB;
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS pipeline_log JSONB;
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS review_version INT DEFAULT 1;
ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6);
