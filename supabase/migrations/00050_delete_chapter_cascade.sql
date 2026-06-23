-- Atomic chapter deletion.
--
-- Most children of a chapter cascade on delete, but three FKs are NO ACTION
-- (media, partners, team_join_requests) and would block a plain DELETE. Doing
-- those deletes from the app as separate statements is not atomic: if a later
-- delete fails, the chapter is left partially stripped. This function performs
-- the whole operation in a single transaction (a function body is atomic), so it
-- either fully deletes the chapter and its blocking children or changes nothing.
--
-- SECURITY DEFINER is not needed: the app calls this via the service-role client
-- (createAdminClient), which bypasses RLS. Authorization is enforced in the
-- server action (global admins only) before this is ever called.
create or replace function delete_chapter_cascade(target_chapter_id uuid)
returns void
language plpgsql
as $$
begin
  -- The NO-ACTION children must go first or the chapter delete raises a FK error.
  delete from media where chapter_id = target_chapter_id;
  delete from partners where chapter_id = target_chapter_id;
  delete from team_join_requests where chapter_id = target_chapter_id;

  -- The remaining children cascade via their ON DELETE CASCADE FKs.
  delete from chapters where id = target_chapter_id;
end;
$$;

-- PostgREST exposes public functions as RPC and grants EXECUTE to all roles by
-- default. This is a destructive admin-only operation, so remove it from the
-- public RPC surface entirely: only the service-role client (used by the
-- global-admin-gated server action) may call it. Without this, an authenticated
-- user could POST /rpc/delete_chapter_cascade (RLS on the underlying tables would
-- still block their deletes, but the function should not be callable at all).
revoke execute on function public.delete_chapter_cascade(uuid) from public;
revoke execute on function public.delete_chapter_cascade(uuid) from anon, authenticated;
grant execute on function public.delete_chapter_cascade(uuid) to service_role;
