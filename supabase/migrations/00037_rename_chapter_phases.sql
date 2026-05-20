-- Rename chapter status enum values to match the actual event workflow.
-- "screening" → "preparation" (this is the event-day prep phase, not just screening)
-- "registration_open" → "challenge_selection" (teams pick challenges, not "registration")

ALTER TYPE chapter_status RENAME VALUE 'screening' TO 'preparation';
ALTER TYPE chapter_status RENAME VALUE 'registration_open' TO 'challenge_selection';
