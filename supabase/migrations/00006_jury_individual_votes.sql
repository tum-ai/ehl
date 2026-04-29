-- Jury workflow: individual votes instead of collective ranking

-- Add status to jury_assignments to track voting progress
ALTER TABLE jury_assignments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'voted', 'skipped'));

-- Allow multiple rankings per challenge (one per jury member)
-- Drop the is_final constraint approach, each jury member gets their own ranking
-- The existing unique constraint is (id), so multiple entries per challenge are fine.
-- Add a unique constraint so each jury member can only submit once per challenge.
ALTER TABLE jury_rankings ADD CONSTRAINT jury_rankings_unique_per_juror
  UNIQUE (challenge_id, entered_by);

-- Track when admin finalizes the jury vote for a challenge
ALTER TABLE challenges ADD COLUMN jury_finalized_at TIMESTAMPTZ;
ALTER TABLE challenges ADD COLUMN jury_finalized_by UUID REFERENCES profiles(id);
