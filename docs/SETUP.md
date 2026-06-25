# EHL Platform: Setup from Scratch

Complete guide to deploy the European Hackathon League platform on your own infrastructure. Follow every section in order.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Supabase (Database + Auth)](#2-supabase-database--auth)
3. [Google Cloud (OAuth + Drive)](#3-google-cloud-oauth--drive)
4. [Cloudflare (Domain + Turnstile)](#4-cloudflare-domain--turnstile)
5. [Email (SMTP)](#5-email-smtp)
6. [GitHub (Code Reviews + Repo Forks)](#6-github-code-reviews--repo-forks)
7. [Upstash Redis (Rate Limiting)](#7-upstash-redis-rate-limiting)
8. [OpenRouter (AI Code Reviews)](#8-openrouter-ai-code-reviews)
9. [Vercel (Hosting)](#9-vercel-hosting)
10. [Environment Variables Reference](#10-environment-variables-reference)
11. [First Deploy Checklist](#11-first-deploy-checklist)
12. [Scaling for More Users](#12-scaling-for-more-users)

---

## 1. Prerequisites

- Node.js 20+ and pnpm installed
- A GitHub account with access to the repo
- A credit card for Vercel Pro ($20/mo) and optional paid tiers
- A custom domain (e.g. `ehl.gg`) or willingness to use `*.vercel.app`

---

## 2. Supabase (Database + Auth)

Supabase provides the Postgres database, authentication, and file storage (partner logos).

### 2.1 Create Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a region close to your users (e.g. `eu-central-1` for Europe)
3. Set a strong database password and save it

### 2.2 Run Migrations

Apply all migrations in `supabase/migrations/` in numerical order:

```bash
# From the project root
for f in supabase/migrations/*.sql; do
  PGPASSWORD='<your-db-password>' psql \
    -h db.<your-project-ref>.supabase.co \
    -U postgres -d postgres \
    -f "$f"
  echo "Applied: $f"
done
```

There are 31 migrations (00001 through 00031). They must run in order.

### 2.3 Configure Auth Settings

In the Supabase Dashboard under **Authentication > Settings**:

1. **Disable direct signups**: Under "User Signups", set **"Allow new users to sign up"** to **disabled**. This is a critical security setting. The platform creates user accounts exclusively through the admin service role key (`admin.createUser()` in the registration server action), so direct Supabase signups must be blocked to prevent attackers from creating accounts that bypass the app's verification flow.

### 2.4 Configure Auth Providers

In the Supabase Dashboard under **Authentication > Providers**:

1. **Email**: Enable "Email" provider (used for participants)
   - Disable "Confirm email" (the app handles verification itself via encrypted codes)
   - Disable all default email templates (the app sends its own branded emails)
2. **Google**: Enable "Google" provider (used for admin login only)
   - Client ID and Secret come from Google Cloud (see Section 3)

### 2.5 Configure Auth URLs

Under **Authentication > URL Configuration**:

- **Site URL**: `https://yourdomain.com`
- **Redirect URLs**: Add:
  - `https://yourdomain.com/auth/callback`
  - `http://localhost:3000/auth/callback` (for local dev)

### 2.6 Collect Credentials

From **Settings > API**:

| What | Where to use |
|------|-------------|
| Project URL (`https://xxx.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

### 2.7 Storage Bucket

Create a public bucket called `partners` under **Storage**. This is used for partner logo uploads.

---

## 3. Google Cloud (OAuth + Drive)

Google Cloud provides OAuth (admin login) and Google Drive (file storage for CVs, submissions, briefs).

### 3.1 Create Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "EHL Platform")

### 3.2 OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose "External" user type
3. Fill in app name, support email, authorized domains
4. Add scopes: `openid`, `email`, `profile`
5. **Important**: Move from "Testing" to "Production" to remove the 100-user cap

### 3.3 OAuth Client Credentials

1. Go to **APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID**
2. Type: Web application
3. Authorized redirect URIs:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client Secret into Supabase (Section 2.3)

### 3.4 Google Drive Service Account

1. Go to **IAM & Admin > Service Accounts**
2. Create a service account (e.g. "ehl-drive")
3. Create a JSON key and download it
4. Enable the **Google Drive API** under APIs & Services
5. Create a shared Drive folder for file uploads
6. Share that folder with the service account email (`ehl-drive@xxx.iam.gserviceaccount.com`)

| What | Where to use |
|------|-------------|
| Base64-encoded JSON key (`cat key.json \| base64`) | `GOOGLE_DRIVE_CREDENTIALS` |
| Shared folder ID (from the folder URL) | `GOOGLE_DRIVE_ROOT_FOLDER_ID` |

---

## 4. Cloudflare (Domain + Turnstile)

Cloudflare manages DNS and provides Turnstile CAPTCHA for bot protection.

### 4.1 Domain Setup

1. Register or transfer your domain to Cloudflare (or just use Cloudflare DNS)
2. Point the domain to Vercel (see Section 9)

### 4.2 Turnstile Widget

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) > **Turnstile**
2. Create a new widget
3. Add your domain(s) to the allowed list
4. Choose "Managed" mode

| What | Where to use |
|------|-------------|
| Site Key | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Secret Key | `TURNSTILE_SECRET_KEY` |

Turnstile protects: login, registration, password reset, application submission, jury login.

---

## 5. Email (SMTP)

The platform sends branded transactional emails (welcome, verification codes, acceptance, certificates, etc.). Any SMTP provider works.

### Option A: Gmail (free, good for <500 emails/day)

1. Use a Google Workspace or Gmail account
2. Enable 2FA on the account
3. Generate an App Password: **Google Account > Security > App Passwords**

### Option B: Dedicated provider (SendGrid, Resend, Postmark, etc.)

Follow their setup instructions and get SMTP credentials.

| Variable | Example Value |
|----------|--------------|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `your-smtp@your-org.com` |
| `SMTP_PASSWORD` | `<app-password>` |
| `SMTP_FROM` | `European Hackathon League <your-smtp@your-org.com>` |

---

## 6. GitHub (Code Reviews + Repo Forks)

GitHub is used for two things: (1) forking participant repos for jury review, and (2) running the AI code review pipeline.

### 6.1 Bot Account

Create a dedicated GitHub account (e.g. `ehl-gg`) for automated operations. Using a bot account prevents rate limits on personal accounts.

### 6.2 Organizations

1. **Main org** (e.g. `tum-ai`): Hosts the platform repo
2. **Snapshot org** (e.g. `european-hackathon-league`): Where participant repos get forked to. Keeps forks isolated from the main org.
3. Add the bot account as a member of both orgs

### 6.3 Personal Access Token

On the bot account, create a PAT (classic) with scopes:
- `repo` (full control of private repos)
- `workflow` (update GitHub Actions workflows)
- `delete_repo` (clean up snapshot forks)

| What | Where to use |
|------|-------------|
| PAT | `GITHUB_TOKEN` (Vercel) + `GH_PAT` (GitHub Actions) |
| Main repo | `GITHUB_REPO` (e.g. `your-org/ehl`) |
| Snapshot org | `GITHUB_ORG` (e.g. `european-hackathon-league`) |

### 6.4 GitHub Actions Secrets

In the main repo under **Settings > Secrets and variables > Actions**, add:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Same as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as Vercel |
| `OPENROUTER_API_KEY` | Same as Vercel |
| `GH_PAT` | Same PAT (GitHub forbids `GITHUB_`-prefixed secret names) |

### 6.5 Entire Session History (optional, per challenge)

For challenges that require AI session history, participants install [Entire](https://entire.io) and capture their coding session:

1. Install the Entire CLI (see [github.com/entireio/cli](https://github.com/entireio/cli)).
2. In their project repo, run `entire enable --agent <tool>` (supported: `claude-code`, `codex`, `gemini`, `opencode`, `cursor`, `factoryai-droid`, `copilot-cli`). **Antigravity is not supported by Entire.**
3. Code as normal and commit while the AI session is active. Entire writes checkpoints to the `entire/checkpoints/v1` branch.
4. **Push the checkpoint branch** along with their code (`git push` pushes it by default; ensure it is not skipped).
5. For private repos, invite the bot account (`ehl-gg`) as a collaborator so EHL can read the branch.

No EHL-side credentials or service setup are required for Entire: it is client-side and stores data in the participant's own git repo. EHL only reads the branch (via the existing `GH_PAT`) and copies it into the private fork. Enable the requirement per challenge in the admin challenge editor ("Require Entire Session History").

---

## 7. Upstash Redis (Rate Limiting)

Upstash Redis powers rate limiting on auth, registration, uploads, and email sending. Without it, the app still works but rate limiting is silently disabled.

### Setup via Vercel Marketplace (recommended)

1. In the Vercel Dashboard, go to **Marketplace > Upstash Redis**
2. Provision a free instance
3. Vercel automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`

### Setup manually

1. Go to [upstash.com](https://upstash.com) and create a Redis database
2. Set these env vars in Vercel:

| Variable | Value |
|----------|-------|
| `KV_REST_API_URL` | From Upstash dashboard |
| `KV_REST_API_TOKEN` | From Upstash dashboard |

### Free tier limits

- 10,000 commands/day
- 256MB storage
- At ~500 users, auth flows use ~2,000-5,000 commands/day

---

## 8. OpenRouter (AI Code Reviews)

OpenRouter provides access to multiple LLMs for the code review pipeline. Pay-per-use.

1. Go to [openrouter.ai](https://openrouter.ai) and create an account
2. Add credits ($10-30 per chapter is typical)
3. Generate an API key

| What | Where to use |
|------|-------------|
| API Key | `OPENROUTER_API_KEY` |

Cost estimate: ~$0.10-0.30 per code review, ~$10-30 for 100 reviews per chapter.

---

## 9. Vercel (Hosting)

### 9.1 Import Project

1. Go to [vercel.com](https://vercel.com) and import the GitHub repo
2. Framework preset: Next.js (auto-detected)
3. Add all environment variables from Section 10

### 9.2 Custom Domain

Under **Settings > Domains**, add your domain. Vercel gives you DNS records to set in Cloudflare.

### 9.3 Cron Job

The `vercel.json` in the repo configures a cron job that runs every minute, checking deadlines and auto-transitioning chapter statuses so a passed deadline closes within ~a minute rather than at the next midnight. This requires the `CRON_SECRET` env var. Runs are serialized by a self-healing DB lock (`app_settings`, migration `00048`) so an overlapping run exits as a no-op. Minute-cadence crons require the Vercel Pro plan.

### 9.4 Plan

- **Hobby** (free): Works but has 10s function timeout. Code reviews and certificate generation may time out.
- **Pro** ($20/mo): 60s function timeout, recommended for production.

---

## 10. Environment Variables Reference

Complete list of every environment variable. Set all "Required" vars before first deploy.

### Required

| Variable | Source | Description |
|----------|--------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Public/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Service role key (server-only) |
| `SMTP_HOST` | Email provider | SMTP server hostname |
| `SMTP_PORT` | Email provider | SMTP port (465 or 587) |
| `SMTP_USER` | Email provider | SMTP login username |
| `SMTP_PASSWORD` | Email provider | SMTP login password |
| `SMTP_FROM` | You | Sender address (e.g. `EHL <noreply@ehl.gg>`) |
| `NEXT_PUBLIC_SITE_URL` | You | Public URL (e.g. `https://ehl.gg`) |

### GitHub Integration

| Variable | Source | Description |
|----------|--------|-------------|
| `GITHUB_TOKEN` | GitHub bot PAT | For repo forks and jury invites |
| `GITHUB_REPO` | You | Main repo (`owner/repo` format) |
| `GITHUB_ORG` | You | Snapshot fork org name |

### Google Drive

| Variable | Source | Description |
|----------|--------|-------------|
| `GOOGLE_DRIVE_CREDENTIALS` | GCP | Base64-encoded service account JSON |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive | Root folder ID for uploads |

### CAPTCHA

| Variable | Source | Description |
|----------|--------|-------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare | Turnstile widget site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare | Turnstile server-side secret |

### AI Code Reviews

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter | API key for LLM access |

### Rate Limiting (auto-injected by Vercel Marketplace)

| Variable | Source | Description |
|----------|--------|-------------|
| `KV_REST_API_URL` | Upstash/Vercel | Redis REST endpoint |
| `KV_REST_API_TOKEN` | Upstash/Vercel | Redis auth token |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PREVIEW_PASSWORD` | _(none)_ | Set to password-protect the entire site |
| `CRON_SECRET` | _(none)_ | Bearer token for `/api/cron/` endpoints |
| `ADMIN_FALLBACK_EMAILS` | _(none)_ | Comma-separated admin emails (fallback if DB empty) |
| `VERIFICATION_ENCRYPTION_KEY` | _(falls back to service role key)_ | AES-256-GCM key for verification codes |

### Query Limits (optional overrides)

All query limits have sensible defaults. Override via env vars if you need higher limits for larger events:

| Variable | Default | Description |
|----------|---------|-------------|
| `LIMIT_TEAMS` | 500 | Max teams loaded per query |
| `LIMIT_ALL_TEAM_MEMBERS` | 2500 | Max team members loaded |
| `LIMIT_PROFILES` | 1000 | Max profiles loaded |
| `LIMIT_APPLICATIONS_PER_CHAPTER` | 2000 | Max applications per chapter |
| `LIMIT_APPLICATION_STATS` | 5000 | Max application stats rows |
| `LIMIT_SCREENING_SCORES` | 5000 | Max screening scores |
| `LIMIT_SCORES` | 1000 | Max scores loaded |
| `LIMIT_LEADERBOARD` | 500 | Max leaderboard entries |
| `LIMIT_MEDIA` | 200 | Max media items |
| `LIMIT_SUBMISSIONS_PER_CHALLENGE` | 200 | Max submissions per challenge |
| `LIMIT_CODE_REVIEWS_PER_CHALLENGE` | 200 | Max code reviews per challenge |
| `LIMIT_CHAPTER_UNLOCKS` | 500 | Max chapter unlocks |
| `LIMIT_CHALLENGE_REGISTRATIONS` | 500 | Max challenge registrations |
| `LIMIT_USERS_LOOKING_FOR_TEAM` | 500 | Max "looking for team" users |
| `LIMIT_CODE_REVIEW_QUEUE_DEPTH` | 200 | Max concurrent code reviews in queue |
| `LIMIT_BROADCAST_RECIPIENTS` | 200 | Max recipients per chapter broadcast send (capped to fit the function timeout) |
| `LIMIT_BROADCASTS` | 50 | Max broadcast history rows loaded in the admin composer |

To change: go to **Vercel Dashboard > Settings > Environment Variables**, add the variable, redeploy.

---

## 11. First Deploy Checklist

After setting all env vars and deploying:

- [ ] Verify Supabase "Allow new users to sign up" is **disabled** (Section 2.3)
- [ ] Visit the site, confirm the landing page loads
- [ ] Go to `/admin/login`, sign in with Google (your email must be in `ADMIN_FALLBACK_EMAILS`)
- [ ] In the admin panel, go to **Settings** and add your email to the admin allowlist
- [ ] Create a test chapter (Admin > Chapters > New)
- [ ] Test participant registration at `/register`
- [ ] Check that verification email arrives
- [ ] Test application flow at `/apply/<chapter-slug>`
- [ ] Verify Turnstile CAPTCHA appears on login/register forms
- [ ] Test file upload (CV in application, or submission upload)
- [ ] Check admin panel at `/admin` for all sections
- [ ] Verify pre-commit hook works: `git commit --allow-empty -m "test hook"` should run typecheck + unit tests
- [ ] Verify CI pipeline runs on GitHub Actions after pushing

---

## 12. Scaling for More Users

The default configuration supports ~500 concurrent users on free tiers. Here's what to upgrade for larger events:

| Scale | What to upgrade | Cost |
|-------|----------------|------|
| 500+ teams | Supabase Pro ($25/mo): 8GB storage, more connections | $25/mo |
| 1000+ daily users | Increase `LIMIT_*` env vars, monitor Upstash commands | Free |
| 10,000+ users | Upstash Pro ($10/mo): 100K commands/day | $10/mo |
| 50,000+ emails/mo | Switch from Gmail to SendGrid/Resend | ~$20/mo |
| Heavy code reviews | Add OpenRouter credits | $0.10-0.30/review |

**Query limits**: All database query limits are configurable via `LIMIT_*` env vars. The admin panel shows current values at **Settings > Query Limits**. If you see truncated data (a yellow banner appears), increase the relevant limit.

**Supabase free tier watch points:**
- Database: 500MB storage limit
- Auth: 50,000 monthly active users
- Storage: 1GB for partner logos
- 500 concurrent database connections

---

## 13. E2E Test Environment

The E2E tests need real Supabase Auth (magic links, `generateLink`, admin user creation),
not just Postgres. There are two ways to provide it:

- **CI: ephemeral local stack (no setup, fully isolated).** The `e2e` and `cross-browser`
  GitHub Actions jobs boot their own throwaway Supabase per run via the CLI
  (`supabase start`, config in `supabase/config.toml`), apply `supabase/migrations/*`, seed
  with `pnpm test:seed-local`, and tear down with `supabase stop`. Because each run gets a
  private DB, E2E runs go **parallel across branches/PRs** — there is no shared remote DB to
  serialize against. The well-known local-dev anon/service keys it prints are non-secret and
  captured dynamically into the job env, so **no `TEST_SUPABASE_*` secrets are required for
  CI E2E**. You can run the same stack locally (Docker required): `supabase start` ->
  `pnpm test:seed-local` -> `pnpm test:e2e:lifecycle`. See `docs/TESTING.md` section 3.
- **A persistent remote test Supabase (sections 13.1-13.6 below).** Still used for
  `pnpm db:check:test` (the migration-applied probe in the `checks` job, gated on the
  `SUPABASE_ACCESS_TOKEN` + `SUPABASE_TEST_REF` secrets) and for manual runs against a hosted
  DB. It is **no longer used by the CI E2E jobs**.

This section explains how to set up the remote instance (option B).

### 13.1 Create a Test Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier is fine)
2. Note the project URL, anon key, and service role key from **Settings > API**
3. Note the database password from **Settings > Database**

### 13.2 Configure Supabase Settings (Automated)

The setup script configures everything automatically:

```bash
# Get a personal access token from: https://supabase.com/dashboard/account/tokens
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm test:setup-supabase
```

This configures: auth settings (disable signup, site URL, redirects, email provider), storage buckets (public), applies all migrations, loads seed data, and verifies everything.

**Manual alternative** (if you prefer): Configure in the test project dashboard:

| Setting | Location | Value |
|---------|----------|-------|
| **Disable signups** | Authentication > Settings | "Allow new users to sign up" = **OFF** |
| **Site URL** | Authentication > URL Configuration | `http://localhost:3001` |
| **Redirect URLs** | Authentication > URL Configuration | Add `http://localhost:3001/auth/callback` |
| **Email provider** | Authentication > Providers | Enable Email, disable "Confirm email" |
| **Google OAuth** | Authentication > Providers | Not needed (tests use magic link shortcut) |
| **Storage buckets** | Storage | Create: `partner-logos`, `hero-images`, `sponsor-logos` (public) |

Then run `pnpm test:setup-db` to apply migrations and seed data.

### 13.3 Create `.env.test`

Copy `.env.test` from a teammate or create it from this template:

```env
# Test Supabase (separate instance - NEVER production!)
NEXT_PUBLIC_SUPABASE_URL=https://your-test-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
SUPABASE_DB_PASSWORD="your-db-password"

# Site URL (test server runs on port 3001)
NEXT_PUBLIC_SITE_URL=http://localhost:3001

# Turnstile (test keys - always pass)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# SMTP (same as production - emails go to @test-ehl.com which is harmless)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-smtp@your-org.com
SMTP_PASSWORD="your-app-password"
SMTP_FROM="European Hackathon League <your-smtp@your-org.com>"

# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_ORG=european-hackathon-league

# Encryption
VERIFICATION_ENCRYPTION_KEY=e2e-test-encryption-key-not-for-production

# Admin fallback
ADMIN_FALLBACK_EMAILS=e2e-admin@test-ehl.com
```

### 13.4 Apply Migrations + Seed Data

```bash
# Requires psql: brew install libpq && brew link --force libpq
pnpm test:setup-db
```

This applies all 31 migrations and loads seed data into the test database.

### 13.5 Run Tests

```bash
# Full lifecycle test (recommended after changes)
pnpm test:e2e:lifecycle

# All E2E tests (lifecycle + smoke + cleanup)
pnpm test:e2e

# Unit tests only
pnpm test
```

The test server starts automatically on port 3001 (separate from your dev server on 3000).

### 13.6 Test Architecture

- **Test DB**: Separate Supabase instance, never touches production
- **Test data**: All created with `e2e-*` prefix, cleaned up automatically
- **GitHub**: Uses permanent test repo `european-hackathon-league/e2e-test-submission`
- **Google Drive**: Set `GOOGLE_DRIVE_ROOT_FOLDER_ID` to a test folder (or omit to skip photo tests)
- **Auth**: Admin uses magic link shortcut (OAuth not automatable), jury uses magic links, participants use email/password

---

## 14. Development Workflow

### Pre-Commit Hook (automatic)

A Husky pre-commit hook runs automatically on every `git commit`:
- Blocks `.skip`, `.only`, `xit`, `xdescribe` in test files
- Blocks commented-out tests
- Runs `pnpm typecheck` (TypeScript check)
- Runs `pnpm test` (153 unit tests)

Total: ~10 seconds. If it fails, the commit is blocked. Fix the issue, don't use `--no-verify`.

### CI Pipeline (automatic)

GitHub Actions runs on every push to `main` and every PR:

| Job | What | Duration |
|-----|------|----------|
| `Lint + Types + Unit` | Typecheck + unit tests (+ optional remote migration-applied probe) | ~1 min |
| `E2E Lifecycle` | Boots an ephemeral local Supabase (`supabase start`), seeds it, runs the lifecycle suite | ~6 min |
| `Cross-browser smoke` | Same ephemeral stack, smoke tests on Firefox + WebKit (push to `main` only) | ~10 min |

E2E jobs each get a private Supabase, so they run **in parallel across branches/PRs** (no
shared-DB serialization). Results visible at: your repo's Actions tab on GitHub.

### Before Marking Work Done

```bash
pnpm typecheck            # Types OK?
pnpm test                 # 153 unit tests green?
pnpm build                # Production build works?
pnpm test:e2e:lifecycle   # 37 E2E tests green?
```

See `docs/TESTING.md` for the full test architecture and extension guide.
