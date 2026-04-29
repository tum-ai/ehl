-- Simplify partner tiers to: challenge_partner, tech_partner, community_partner
-- Map old tiers to new ones

-- Add new tier values to the enum
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'challenge_partner';
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'tech_partner';
ALTER TYPE partner_tier ADD VALUE IF NOT EXISTS 'community_partner';

-- Migrate existing data to new tiers
UPDATE partners SET tier = 'challenge_partner' WHERE tier = 'challenge';
UPDATE partners SET tier = 'tech_partner' WHERE tier = 'tech';
UPDATE partners SET tier = 'community_partner' WHERE tier IN ('title', 'gold', 'silver', 'chapter_host');

-- Add is_scored flag to challenges
-- Challenge partner challenges are scored (count for league points)
-- Community partner challenges are not scored
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_scored BOOLEAN NOT NULL DEFAULT true;
