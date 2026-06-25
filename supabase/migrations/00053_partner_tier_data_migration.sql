-- Data migration split out of 00008_partner_tiers_and_scored_challenges.sql.
--
-- 00008 ADDs the new partner_tier enum values (challenge_partner, tech_partner,
-- community_partner). A newly added enum value cannot be USED in the same
-- transaction it was added in (Postgres SQLSTATE 55P04), and the Supabase CLI
-- (`supabase start` / `db reset`) wraps each migration file in a single
-- transaction. The original UPDATEs therefore lived in 00008 and broke local
-- stack provisioning. They are moved here so they run in a later, separate
-- transaction, after 00008 has committed.
--
-- Idempotent: on the remote DBs (already migrated ad-hoc via the Management
-- API) and on a fresh local stack (partners table empty at migration time)
-- these UPDATEs are no-ops. The legacy enum literals ('challenge', 'tech',
-- 'title', 'gold', 'silver', 'chapter_host') still exist on the type
-- (ADD VALUE never removes values), so the WHERE clauses remain valid.

UPDATE partners SET tier = 'challenge_partner' WHERE tier = 'challenge';
UPDATE partners SET tier = 'tech_partner' WHERE tier = 'tech';
UPDATE partners SET tier = 'community_partner' WHERE tier IN ('title', 'gold', 'silver', 'chapter_host');
