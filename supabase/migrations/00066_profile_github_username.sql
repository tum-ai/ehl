-- Jury GitHub usernames.
--
-- Adding a juror to a PRIVATE snapshot fork needs a GitHub *username*; the
-- account email an admin types at invite time is usually not the address on the
-- juror's GitHub profile, and the email-search fallback only ever matched
-- jurors who had made that address public. Store the username explicitly.
--
-- Lives on `profiles` rather than `jury_assignments` because it identifies the
-- person, not the assignment: a juror on three challenges has one GitHub
-- account.

alter table profiles
  add column if not exists github_username text;

comment on column profiles.github_username is
  'Bare GitHub username (no @, no URL) used to invite jury as read collaborators on private snapshot forks.';

-- Case-insensitive uniqueness is deliberately NOT enforced: GitHub usernames are
-- unique upstream, but a typo shared between two jurors must not block an
-- invite. Index for lookup only.
create index if not exists idx_profiles_github_username
  on profiles (lower(github_username))
  where github_username is not null;
