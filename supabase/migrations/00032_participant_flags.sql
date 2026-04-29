-- Participant flags: admin annotations on participants, visible during screening.
-- Flags match across emails via LinkedIn username, GitHub username, and name.

create table participant_flags (
  id uuid primary key default uuid_generate_v4(),
  -- Identifiers for cross-email matching (stored at flag creation time)
  email text not null,
  name text,
  linkedin_username text,
  github_username text,
  -- Flag content
  reason text not null,
  screenshot_url text,
  -- Traceability
  created_by uuid not null references profiles(id),
  created_at timestamptz default now(),
  -- Soft-delete: resolve instead of delete for audit trail
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolved_reason text
);

-- Indexes for matching during screening enrichment
create index idx_flags_email on participant_flags(lower(email));
create index idx_flags_linkedin on participant_flags(linkedin_username) where linkedin_username is not null;
create index idx_flags_github on participant_flags(github_username) where github_username is not null;
create index idx_flags_name on participant_flags(lower(name)) where name is not null;
create index idx_flags_active on participant_flags(id) where resolved_at is null;

alter table participant_flags enable row level security;

-- Admin-only: read, insert, update (no delete - resolve instead)
create policy "Admin read flags" on participant_flags
  for select using (
    exists (select 1 from admin_emails ae where ae.email = (select email from auth.users where id = auth.uid()))
  );

create policy "Admin insert flags" on participant_flags
  for insert with check (
    exists (select 1 from admin_emails ae where ae.email = (select email from auth.users where id = auth.uid()))
  );

create policy "Admin update flags" on participant_flags
  for update using (
    exists (select 1 from admin_emails ae where ae.email = (select email from auth.users where id = auth.uid()))
  );
