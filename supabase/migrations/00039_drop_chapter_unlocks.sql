-- Drop chapter_unlocks table.
-- Manual team unlocks replaced by automatic check-in based access.
-- Teams gain event access when their members check in, no admin unlock needed.

DROP TABLE IF EXISTS chapter_unlocks CASCADE;
