-- Make Entire session history required BY DEFAULT for new challenges.
--
-- 00042 introduced challenges.entire_required with DEFAULT false. After the Paris
-- dry-run we want it ON by default (the league expects an Entire session record),
-- still toggleable per challenge. This only changes the column DEFAULT for rows
-- inserted WITHOUT an explicit value; it does NOT touch existing challenges.
alter table challenges alter column entire_required set default true;
