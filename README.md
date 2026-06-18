# European Hackathon League

Season 1 platform for the European Hackathon League: public website, participant registration, event-day tooling, jury voting, AI-powered code reviews, and admin panel.

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| **This README** | Developers | Setup, architecture, deployment |
| [docs/LOCAL.md](docs/LOCAL.md) | Developers | Running locally: test DB, Turnstile bypass, admin OAuth |
| [CLAUDE.md](CLAUDE.md) | AI assistants (Claude Code) | Conventions, critical rules, architecture |
| [RULES.md](RULES.md) | Developers | Pre-commit checklist, security/correctness rules |
| [docs/SETUP.md](docs/SETUP.md) | New deployers | From-scratch deployment with all services |
| [docs/FEATURES.md](docs/FEATURES.md) | Hackathon organizers | Complete feature list by user role |
| [docs/SECURITY.md](docs/SECURITY.md) | Security reviewers | Defense architecture, limits, attack surface |
| [docs/ACCOUNTS.template.md](docs/ACCOUNTS.template.md) | Deployers | Service account directory template |

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript, Server Components)
- **Styling**: Tailwind CSS v4 (CSS-based config in `globals.css`, no `tailwind.config.ts`)
- **Database**: Supabase (Postgres + Auth + Storage)
- **File Storage**: Google Drive (CVs, submissions, briefs, photos) + Supabase Storage (partner logos)
- **Email**: Nodemailer with React Email templates
- **Code Reviews**: Multi-agent AI pipeline via OpenRouter, executed in GitHub Actions
- **Hosting**: Vercel (Hobby plan)
- **Package Manager**: pnpm

## Features

### Public Website
- **Landing page**: Hero, video embed, "How it Works" section, tour timeline, leaderboard preview, partner bar
- **Chapters (matches)**: List of all season matches with status-dependent detail pages (announced, applications open, hacking, pitching, completed with results)
- **Leaderboard**: Season standings with podium for top 3, sortable table, scoring explanation
- **Team profiles**: Public team pages with members, university, scores
- **Rules**: Scoring system, season structure, team rules
- **Partners**: Per-match partner showcase (challenge, tech, community tiers)

### Participant System
- **Registration**: Solo registration or team registration with member invites, email verification with encrypted temporary password storage
- **Dashboard**: Team management (invite members, accept/decline invites, join requests), looking-for-team/looking-for-members matching
- **Applications**: Per-chapter application form with CV upload, team member listing, consent management

### Event Day
- **Check-in**: Admin QR code scanner for participant check-in
- **Challenge selection**: Teams browse and register for challenges after check-in
- **Team formation**: Event-day team creation, join requests, search for teammates
- **Submissions**: File uploads (Google Drive), repo links with fork verification, tech stack tags, deadline countdown
- **Pitch order**: Randomized or manual pitch ordering per challenge

### Jury System
- **Magic link auth**: Jury members log in via email magic link (no password)
- **Submission review**: Browse assigned submissions with full detail view (fields, code review, repo)
- **Ranking**: Drag-and-drop ranking per challenge with placement-based scoring
- **Feedback**: Per-team feedback notes

### AI Code Reviews
- **Multi-agent pipeline**: 5-stage review (tech description, code quality, highlights/issues, originality, coordinator)
- **Configurable per challenge**: Model selection, scoring weights, language, token budget
- **Automated**: Triggered after submission deadline via GitHub Actions (bypasses Vercel 10s timeout)
- **Report cards**: Visual score display with weighted totals, highlights, concerns, "would it run" verdict

### Admin Panel
- **Chapter management**: Create/edit chapters, control status progression (draft to completed), configure deadlines
- **Application screening**: Review applications with scoring, accept/reject/waitlist in bulk, send branded emails
- **Challenge configuration**: Define submission fields, scoring criteria, code review settings, challenge briefs (PDF)
- **Team oversight**: View all teams, members, remove members, delete teams
- **Score management**: View jury rankings, override scores, publish results
- **Jury management**: Invite jury members, assign to challenges, track voting progress
- **Partner management**: Add/edit partners per chapter with logo upload
- **Settings**: Site-wide configuration (admin emails, feature toggles)

## Project Structure

```
app/
  layout.tsx                    Root layout (fonts, metadata)
  (public)/                     Public pages (Nav + Footer layout)
    page.tsx                    Landing page
    chapters/                   Match listing + detail pages
    leaderboard/                Season standings
    rules/                      Scoring rules
    partners/                   Partner showcase
    apply/[chapter-slug]/       Application form
    register/                   Team/solo registration
    login/                      Participant login
    team/[slug]/                Public team profile
  (participant)/                Authenticated participant pages
    dashboard/                  Team management, invites
    event/[slug]/               Event-day hub (check-in, challenges, submissions)
  admin/                        Admin panel (light theme, sidebar layout)
    chapters/[id]/              Chapter detail with sub-pages
      applications/             Application screening
      challenges/               Challenge config
      code-reviews/             Code review management
      scores/                   Score overview
      unlocks/                  Chapter unlock management
    jury/                       Jury member management
    teams/                      Team oversight
    check-in/                   QR code check-in
    partners/                   Partner management
  jury/                         Jury evaluation interface
    [chapter-slug]/             Submission list per chapter
      submission/[id]/          Full submission detail view
      rank/                     Ranking interface
  api/                          REST API endpoints
    cron/deadline-check/        Automated status transitions

components/
  ui/                           Primitives: Button, Card, Badge, Section, Toggle, Accordion
  layout/                       Navbar, Footer, MobileNav
  landing/                      Hero, HowItWorks, TourTimeline, LeaderboardPreview, PartnersBar
  chapter/                      ChapterCard, status-specific views (announced, hacking, completed...)
  leaderboard/                  Podium, Table, ScoringExplainer
  dashboard/                    TeamManagement, TeamlessView
  event/                        EventHub, TeamSelector, ChallengeSelector, JoinRequestManager
  submission/                   SubmissionForm, DeadlineCountdown
  application/                  ApplicationForm
  code-review/                  ReportCard
  admin/                        Sidebar
  partners/                     PartnerCard

lib/
  actions/                      Server actions (Next.js "use server")
    registration.ts             Solo + team registration with email verification
    teams.ts                    Team invites, join requests, member management
    submissions.ts              Project submission, locking, forking
    jury.ts                     Jury assignment, ranking, feedback
    admin.ts                    Chapter status, scores, config, bulk operations
    applications.ts             Application CRUD, screening, acceptance emails
    event.ts                    Event-day actions (team creation, challenge registration)
    auth.ts                     Session management, password reset
    screening.ts                Application screening scores
    admin-users.ts              Admin user management
    settings.ts                 Site settings
  queries/                      Supabase read queries (split by domain)
    chapters.ts                 Chapters, scores, leaderboard, partners, media
    teams.ts                    Teams, members, invites, join requests
    challenges.ts               Challenges, unlocks, registrations
    submissions.ts              Submissions, code reviews
    jury.ts                     Jury assignments, rankings, feedback
    applications.ts             Applications, screening scores
    profiles.ts                 User profiles
    mappers.ts                  DB row to domain type mappers
    client.ts                   Supabase server client factory
  emails/                       React Email templates (EHL branded)
  code-review/                  AI code review pipeline
  supabase/                     Supabase client configs (client, server, admin, middleware)
  crypto.ts                     AES-256-GCM encryption for verification codes
  github.ts                     GitHub API (fork repos, sync upstream)
  gdrive.ts                     Google Drive API (upload, download, folders)
  email.ts                      SMTP transport with inline logo
  scoring.ts                    Placement points calculation
  types.ts                      All TypeScript domain types
  utils.ts                      cn(), formatDate(), slugify(), getPlacementLabel()

supabase/
  migrations/                   21 sequential SQL migrations
  seed.sql                      Development seed data

scripts/
  process-code-reviews.ts       Batch code review processing (runs in GitHub Actions)
  import-teams-csv.ts           CSV team import utility
  import-team-members.ts        Team member import utility
```

## Local Development

```bash
pnpm install
pnpm dev
```

Requires `.env.local` with Supabase variables at minimum. Copy from Vercel:

```bash
vercel env pull .env.local
```

Or create manually with at least:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm test` | Run tests (Vitest) |

## Deployment

### 1. Vercel

Import the GitHub repo in the Vercel dashboard. Framework preset: Next.js (auto-detected). Push to `main` triggers auto-deploy.

### 2. Environment Variables

Set in Vercel under **Settings > Environment Variables**:

#### Required

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only, bypasses RLS) |

#### Email (SMTP)

| Variable | Description |
|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | e.g. `465` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password / app password |
| `SMTP_FROM` | Sender address, e.g. `EHL <noreply@ehl.gg>` |

#### GitHub Integration

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | PAT (`repo`, `workflow`, `delete_repo`) for ehl-gg bot account |
| `GITHUB_REPO` | Repository in `owner/repo` format |
| `GITHUB_ORG` | GitHub org for forking repos, e.g. `european-hackathon-league` |

#### AI Code Reviews

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM-based code review |

#### Google Drive

| Variable | Description |
|---|---|
| `GOOGLE_DRIVE_CREDENTIALS` | Base64-encoded service account JSON credentials |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Root folder ID for uploaded documents |

#### Optional

| Variable | Description |
|---|---|
| `PREVIEW_PASSWORD` | Password-protect the entire site. Remove to make public. |
| `NEXT_PUBLIC_SITE_URL` | Public URL, e.g. `https://ehl.gg`. Used in email links. |
| `CRON_SECRET` | Shared secret for `/api/cron/` endpoints (Vercel Cron) |
| `ADMIN_FALLBACK_EMAILS` | Comma-separated admin emails (fallback if DB is empty) |
| `VERIFICATION_ENCRYPTION_KEY` | Key for encrypting passwords in verification codes (falls back to service role key) |

### 3. GitHub Actions Secrets

For automated code reviews, set in the GitHub repo under **Settings > Secrets and variables > Actions**:

| Secret | Description |
|---|---|
| `SUPABASE_URL` | Same as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as Vercel |
| `OPENROUTER_API_KEY` | Same as Vercel |
| `GH_PAT` | Same ehl-gg PAT as Vercel (GitHub prohibits `GITHUB_`-prefixed secret names) |

### 4. Database

Schema lives in `supabase/migrations/`. Apply migrations manually in order:

```bash
PGPASSWORD='<password>' psql -h db.<project-ref>.supabase.co -U postgres -d postgres \
  -f supabase/migrations/00001_initial_schema.sql
# ... repeat for each migration
```

When switching to a new Supabase project: create project, run all 21 migrations in order, update env vars.

### 5. Custom Domain

In Vercel: **Settings > Domains > Add**. Point DNS (CNAME or A record) as instructed.

## Authentication

Three separate auth flows, strictly separated:

| Role | Auth Method | Login Page |
|------|-------------|------------|
| **Admin** | Google OAuth only | `/admin/login` |
| **Jury** | Email magic link only | `/jury/login` |
| **Participant** | Email + password | `/login` or `/register` |

Admin access is controlled by an email allowlist (DB table `admin_emails` + `ADMIN_FALLBACK_EMAILS` env var). Jury members are invited by admins. Participants self-register.

## Scoring System

Each match awards placement points per challenge:

| Placement | Points |
|-----------|--------|
| 1st | 8 |
| 2nd | 7 |
| 3rd | 6 |
| 4th-5th | 4 |
| 6th+ (participated) | 2 |

Season standings aggregate points across all matches. Tiebreaker: best single-match finish.

## Deploying for Your Organization

This platform is designed to be deployed by any organization. Key configuration:

1. **Vercel**: Import repo, add all env vars from `.env.local.example`.
2. **Supabase**: Create project, run all migrations, set auth providers.
3. **Domain**: Point DNS to Vercel deployment.
4. **Admin Domain**: Set `ADMIN_EMAIL_DOMAIN` to your org's email domain.
5. **Branding**: Set `NEXT_PUBLIC_ORG_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`, and social link env vars.

See [docs/SETUP.md](docs/SETUP.md) for the full deployment guide.
