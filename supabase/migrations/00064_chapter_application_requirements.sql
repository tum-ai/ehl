-- Per-chapter application requirements
--
-- Which fields the public application form makes mandatory used to be hardcoded
-- in components/application/application-fields.tsx (getMissingFields), so every
-- chapter rendered an identical form and any change needed a deploy. These two
-- flags let a global admin decide per chapter, from the chapter edit screen.
--
-- These live ON chapters (publicly readable) rather than in a separate admin-only
-- table like chapter_communications / chapter_walk_in: those hold secrets, while
-- "this form requires a CV" is visible to any applicant who opens the form.
--
-- Default false = today's behavior for every existing and seeded chapter.
-- They gate SUBMISSION only; applications already stored are unaffected.

ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS require_cv boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_motivation boolean NOT NULL DEFAULT false;
