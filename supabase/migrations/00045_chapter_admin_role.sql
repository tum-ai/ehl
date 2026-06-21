-- Local (chapter) admins: a new role scoped to a single chapter.
--
-- A chapter_admin can administer ONE chapter (review screening, check
-- people in, view that chapter's teams/submissions) but cannot see other
-- chapters or any global admin tooling. The chapter assignment lives in
-- the chapter_admins table (added in 00046). This migration only adds the
-- enum value.
--
-- ALTER TYPE ... ADD VALUE must not be USED in the same transaction it is
-- added in. We only add the value here (no usage), and create the table /
-- write rows in 00046 and at runtime, so this is safe.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chapter_admin';
