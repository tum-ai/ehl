-- EHL Phase 2 Schema Migration
-- Adds: challenges, team_members, chapter_unlocks, challenge_registrations,
--        submissions, code_reviews, pitch_orders, jury_assignments,
--        jury_rankings, jury_feedback
-- Alters: teams, chapters, scores

-- ─── ALTER EXISTING TABLES ─────────────────────────────────

-- Teams: link to president user
alter table teams add column if not exists president_user_id uuid references profiles(id);

-- Chapters: submission deadline + code review toggle
alter table chapters add column if not exists submission_deadline timestamptz;
alter table chapters add column if not exists code_review_enabled boolean default false;

-- Scores: link to challenge + source tracking
alter table scores add column if not exists challenge_id uuid;
alter table scores add column if not exists source text default 'admin_override'
  check (source in ('jury', 'admin_override'));

-- ─── NEW TABLES ────────────────────────────────────────────

-- Challenges (1:N per chapter)
create table challenges (
  id uuid primary key default uuid_generate_v4(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  title text not null,
  description text,
  sponsor_name text,
  sponsor_logo_url text,
  prize_description text,
  judging_criteria text,
  submission_fields jsonb default '[
    {"key":"deck","label":"Pitch Deck","type":"file","required":true,"accept":".pdf,.pptx"},
    {"key":"repo","label":"GitHub Repository","type":"url","required":true},
    {"key":"demo","label":"Live Demo","type":"url","required":false}
  ]'::jsonb,
  code_review_enabled boolean default false,
  pitch_duration_minutes int default 3,
  display_order int default 0,
  created_at timestamptz default now()
);

-- Add FK from scores to challenges (after table exists)
alter table scores add constraint scores_challenge_id_fkey
  foreign key (challenge_id) references challenges(id) on delete set null;

-- Team members (president + members)
create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('president', 'member')),
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- Chapter unlocks (admin unlocks teams for a chapter)
create table chapter_unlocks (
  chapter_id uuid not null references chapters(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  unlocked_at timestamptz default now(),
  unlocked_by uuid references profiles(id),
  primary key (chapter_id, team_id)
);

-- Challenge registrations (team picks one challenge per chapter)
create table challenge_registrations (
  id uuid primary key default uuid_generate_v4(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  roster jsonb default '[]'::jsonb,
  registered_at timestamptz default now(),
  unique (chapter_id, team_id)
);

-- Submissions (dynamic fields based on challenge config)
create table submissions (
  id uuid primary key default uuid_generate_v4(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  project_name text not null,
  short_description text,
  fields jsonb default '{}'::jsonb,
  tech_stack jsonb default '[]'::jsonb,
  submitted_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_locked boolean default false,
  unique (challenge_id, team_id)
);

-- Code reviews (LLM-generated)
create table code_reviews (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references submissions(id) on delete cascade,
  repo_url text,
  review_content jsonb,
  model_used text,
  generated_at timestamptz default now(),
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed'))
);

-- Pitch orders (one per challenge)
create table pitch_orders (
  challenge_id uuid primary key references challenges(id) on delete cascade,
  order_list jsonb not null default '[]'::jsonb,
  generated_at timestamptz default now(),
  generated_by uuid references profiles(id)
);

-- Jury assignments
create table jury_assignments (
  user_id uuid not null references profiles(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  assigned_at timestamptz default now(),
  primary key (user_id, challenge_id)
);

-- Jury rankings (collective top-5 per challenge)
create table jury_rankings (
  id uuid primary key default uuid_generate_v4(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  entered_by uuid not null references profiles(id),
  ranking jsonb not null,
  submitted_at timestamptz default now(),
  is_final boolean default false
);

-- Jury feedback (per ranked team)
create table jury_feedback (
  challenge_id uuid not null references challenges(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  feedback_text text,
  submitted_at timestamptz default now(),
  primary key (challenge_id, team_id)
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────

alter table challenges enable row level security;
alter table team_members enable row level security;
alter table chapter_unlocks enable row level security;
alter table challenge_registrations enable row level security;
alter table submissions enable row level security;
alter table code_reviews enable row level security;
alter table pitch_orders enable row level security;
alter table jury_assignments enable row level security;
alter table jury_rankings enable row level security;
alter table jury_feedback enable row level security;

-- ─── PUBLIC READ POLICIES ──────────────────────────────────

-- Challenges: public can read for non-draft chapters
create policy "Public read challenges" on challenges
  for select using (
    exists (
      select 1 from chapters
      where chapters.id = challenges.chapter_id
      and chapters.status != 'draft'
    )
  );

-- Pitch orders: public can read when chapter is pitching or completed
create policy "Public read pitch orders" on pitch_orders
  for select using (
    exists (
      select 1 from challenges c
      join chapters ch on ch.id = c.chapter_id
      where c.id = pitch_orders.challenge_id
      and ch.status in ('pitching', 'completed')
    )
  );

-- Jury feedback: public can read when chapter is completed
create policy "Public read jury feedback" on jury_feedback
  for select using (
    exists (
      select 1 from challenges c
      join chapters ch on ch.id = c.chapter_id
      where c.id = jury_feedback.challenge_id
      and ch.status = 'completed'
    )
  );

-- Team members: public can read (for team profile pages)
create policy "Public read team members" on team_members
  for select using (true);

-- Chapter unlocks: public can check if unlocked
create policy "Public read chapter unlocks" on chapter_unlocks
  for select using (true);

-- Challenge registrations: public can read
create policy "Public read challenge registrations" on challenge_registrations
  for select using (true);

-- ─── TEAM PRESIDENT POLICIES ───────────────────────────────

-- Team presidents can manage their own team members
create policy "President manage team members" on team_members
  for all using (
    exists (
      select 1 from teams
      where teams.id = team_members.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- Team presidents can manage own team's challenge registrations
create policy "President manage registrations" on challenge_registrations
  for all using (
    exists (
      select 1 from teams
      where teams.id = challenge_registrations.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- Team presidents can manage own team's submissions
create policy "President manage submissions" on submissions
  for all using (
    exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- Submissions: public can read own team's submissions
create policy "Public read own submissions" on submissions
  for select using (
    exists (
      select 1 from teams
      where teams.id = submissions.team_id
      and teams.president_user_id = auth.uid()
    )
  );

-- ─── JURY POLICIES ────────────────────────────────────────

-- Jury can read submissions for assigned challenges
create policy "Jury read assigned submissions" on submissions
  for select using (
    exists (
      select 1 from jury_assignments
      where jury_assignments.user_id = auth.uid()
      and jury_assignments.challenge_id = submissions.challenge_id
    )
  );

-- Jury can read code reviews for assigned challenges
create policy "Jury read code reviews" on code_reviews
  for select using (
    exists (
      select 1 from submissions s
      join jury_assignments ja on ja.challenge_id = s.challenge_id
      where s.id = code_reviews.submission_id
      and ja.user_id = auth.uid()
    )
  );

-- Jury can read their own assignments
create policy "Jury read own assignments" on jury_assignments
  for select using (user_id = auth.uid());

-- Jury can create rankings
create policy "Jury create rankings" on jury_rankings
  for insert with check (entered_by = auth.uid());

-- Jury can read own rankings
create policy "Jury read own rankings" on jury_rankings
  for select using (entered_by = auth.uid());

-- Jury can create feedback
create policy "Jury create feedback" on jury_feedback
  for insert with check (
    exists (
      select 1 from jury_assignments
      where jury_assignments.user_id = auth.uid()
      and jury_assignments.challenge_id = jury_feedback.challenge_id
    )
  );

-- ─── ADMIN FULL ACCESS POLICIES ───────────────────────────

create policy "Admin full access challenges" on challenges
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access team members" on team_members
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access chapter unlocks" on chapter_unlocks
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access challenge registrations" on challenge_registrations
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access submissions" on submissions
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access code reviews" on code_reviews
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access pitch orders" on pitch_orders
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access jury assignments" on jury_assignments
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access jury rankings" on jury_rankings
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin full access jury feedback" on jury_feedback
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ─── INDEXES ──────────────────────────────────────────────

create index idx_challenges_chapter on challenges(chapter_id);
create index idx_team_members_team on team_members(team_id);
create index idx_team_members_user on team_members(user_id);
create index idx_chapter_unlocks_team on chapter_unlocks(team_id);
create index idx_challenge_registrations_challenge on challenge_registrations(challenge_id);
create index idx_challenge_registrations_team on challenge_registrations(team_id);
create index idx_submissions_challenge on submissions(challenge_id);
create index idx_submissions_team on submissions(team_id);
create index idx_code_reviews_submission on code_reviews(submission_id);
create index idx_jury_assignments_challenge on jury_assignments(challenge_id);
create index idx_jury_rankings_challenge on jury_rankings(challenge_id);
