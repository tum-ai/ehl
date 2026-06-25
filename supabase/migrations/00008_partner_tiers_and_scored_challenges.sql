-- Simplify partner tiers to: challenge_partner, tech_partner, community_partner
-- Map old tiers to new ones

-- Add new tier values to the enum.
--
-- NOTE: a newly ADDed enum value cannot be USED in the same transaction it is
-- added in (Postgres SQLSTATE 55P04). The Supabase CLI (`supabase start` /
-- `db reset`, used by the ephemeral-stack E2E) wraps each migration file in one
-- transaction, so the old in-file `UPDATE partners SET tier = 'challenge_partner'`
-- failed there. The data migration that USES these values now lives in its own
-- migration (00053_partner_tier_data_migration.sql), which runs in a later,
-- separate transaction. (The remote test/prod DBs were migrated ad-hoc via the
-- Management API, statement-per-request, so they never hit this; the net schema
-- and data state is identical either way.)
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'challenge_partner';
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'tech_partner';
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'community_partner';

-- Add is_scored flag to challenges
-- Challenge partner challenges are scored (count for league points)
-- Community partner challenges are not scored
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_scored BOOLEAN NOT NULL DEFAULT true;
