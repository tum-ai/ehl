-- chapter_admins: assigns a local (chapter) admin to a single chapter.
--
-- Mirrors jury_assignments (00003_phase2_schema.sql:111-118): a join table
-- keyed by (user_id, chapter_id), with the same RLS shape — the assigned
-- user can read their own rows, and global admins have full access. All
-- writes happen via createAdminClient() (service_role), which bypasses RLS.

create table chapter_admins (
  user_id    uuid not null references profiles(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  invited_by uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (user_id, chapter_id)
);

alter table chapter_admins enable row level security;

-- A local admin can read their own assignment(s).
create policy "Chapter admin reads own assignments" on chapter_admins
  for select using (user_id = auth.uid());

-- Global admins have full access.
create policy "Admin full access chapter_admins" on chapter_admins
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
