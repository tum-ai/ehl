-- Remove the local (chapter) admin feature (added in 00045-00047).
--
-- Admin access is global-admin only again. This drops every read policy that
-- referenced chapter_admins, drops the table itself, and moves any remaining
-- chapter_admin profile back to participant.
--
-- The 'chapter_admin' value stays in the user_role enum: Postgres cannot drop an
-- enum value without rebuilding the type that profiles.role uses. After this
-- migration no profile holds it and no code references it.
--
-- The table is dropped WITHOUT cascade on purpose (if exists only so a retry
-- after an ambiguous Management API response is safe): if anything else still
-- depended on it, this migration must fail loudly instead of silently taking
-- that object with it.

drop policy if exists "Chapter admin reads notes for own chapter" on application_notes;
drop policy if exists "Chapter admin reads own chapter_communications" on chapter_communications;
drop policy if exists "Chapter admin reads broadcasts for own chapter" on chapter_broadcasts;
drop policy if exists "Chapter admin reads own chapter_walk_in" on chapter_walk_in;
drop policy if exists "Chapter admin reads own chapter_partner_showcase" on chapter_partner_showcase;
drop policy if exists "Chapter admin reads own application_rsvps" on application_rsvps;
drop policy if exists "Chapter admin reads own finale_invites" on finale_invites;

drop table if exists chapter_admins;

-- profiles_prevent_role_change (00030) rejects role changes unless the caller
-- is the service role. A migration has no JWT, so claim service_role here.
-- set_config(..., true) lasts until the end of the transaction, so this block
-- is deliberately the LAST statement: nothing after it runs under the claim.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update profiles set role = 'participant' where role = 'chapter_admin';
end $$;
