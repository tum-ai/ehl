-- Enforce that a chapter admin is scoped to exactly ONE chapter.
--
-- The application layer already rejects a second invite (inviteChapterAdmin),
-- but a DB constraint is the authoritative guarantee. Without it, a direct
-- INSERT (e.g. via the Supabase dashboard) would silently create a phantom
-- second assignment that is unreachable by getAdminChapterId (which takes
-- limit(1) by created_at).

alter table chapter_admins add constraint chapter_admins_user_id_unique unique (user_id);
