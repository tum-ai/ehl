# EHL Platform: Account Directory

Template for mapping external services. Copy this to `docs/ACCOUNTS.local.md` (gitignored) and fill in your values.

---

## Quick Reference

| Service | Purpose | Account Owner | Login URL |
|---------|---------|---------------|-----------|
| [Vercel](#vercel) | Hosting, deployments, cron | `your-admin@your-org.com` | vercel.com |
| [Supabase](#supabase) | Database, auth, storage | `your-admin@your-org.com` | supabase.com |
| [GitHub](#github) | Source code, CI/CD | `your-admin@your-org.com` | github.com |
| [Google Cloud](#google-cloud) | OAuth, Google Drive | `your-admin@your-org.com` | console.cloud.google.com |
| [Cloudflare](#cloudflare) | DNS, domain, Turnstile | `your-admin@your-org.com` | dash.cloudflare.com |
| [Upstash](#upstash) | Rate limiting (Redis) | Via Vercel Marketplace | upstash.com |
| [OpenRouter](#openrouter) | AI code reviews | `your-admin@your-org.com` | openrouter.ai |
| [Gmail SMTP](#email-smtp) | Transactional emails | `your-smtp@your-org.com` | mail.google.com |

---

## Vercel

**What it does**: Hosts the Next.js application, runs serverless functions, executes daily cron job.

| Field | Value |
|-------|-------|
| Account email | `your-admin@your-org.com` |
| Plan | Pro recommended |
| Dashboard | https://vercel.com/dashboard |

**Key locations in dashboard**:
- Environment variables: Settings > Environment Variables
- Deployment logs: Deployments tab
- Function logs: Logs tab
- Cron jobs: Settings > Cron Jobs
- Domain config: Settings > Domains

---

## Supabase

**What it does**: Postgres database, user authentication (sessions, OAuth, magic links), file storage for partner logos.

| Field | Value |
|-------|-------|
| Account email | `your-admin@your-org.com` |
| Project ref | `your-project-ref` |
| Region | `your-region` |
| Dashboard | `https://supabase.com/dashboard/project/your-project-ref` |

**Direct database access (psql)**:
```
PGPASSWORD='your-db-password' psql -h db.your-project-ref.supabase.co -U postgres -d postgres
```

**Key locations in dashboard**:
- SQL Editor: for running queries
- Auth > Users: see all registered users
- Auth > Providers: Google OAuth config (Client ID + Secret)
- Auth > URL Configuration: redirect URLs
- Storage > partners: partner logo bucket
- Settings > API: anon key, service role key, project URL

**Known quirks**:
- The `leaderboard` is a Postgres VIEW, not a table
- RLS on `profiles` uses `auth.jwt() ->> 'role'` to avoid infinite recursion

---

## GitHub

**What it does**: Source code hosting, CI/CD via Actions, participant repo forks for jury review.

### Main Repository

| Field | Value |
|-------|-------|
| Repository | `your-org/ehl` |
| Dashboard | `https://github.com/your-org/ehl` |

### Snapshot Organization

| Field | Value |
|-------|-------|
| Purpose | Participant repos get forked here for jury review |
| Org name | `your-snapshot-org` |

### Bot Account (optional)

| Field | Value |
|-------|-------|
| Account name | `your-bot-account` |
| PAT scopes | `repo`, `workflow`, `delete_repo` |

**Key locations**:
- Actions secrets: your-org/ehl > Settings > Secrets and variables > Actions
- PAT management: github.com/settings/tokens (logged in as bot account)

---

## Google Cloud

**What it does**: OAuth 2.0 for admin login, Google Drive for file storage (CVs, submissions, briefs, photos).

| Field | Value |
|-------|-------|
| Account email | `your-admin@your-org.com` |
| Console | https://console.cloud.google.com |

### OAuth 2.0 Client

| Field | Value |
|-------|-------|
| Client ID | `your-client-id` |
| Client Secret | `your-client-secret` |
| Authorized redirect URI | `https://your-project-ref.supabase.co/auth/v1/callback` |

**Important**: The OAuth Client ID and Secret are configured in Supabase (Auth > Providers > Google), not directly in the app code.

### Google Drive Service Account

| Field | Value |
|-------|-------|
| Service account email | `your-sa@your-project.iam.gserviceaccount.com` |
| Root folder ID | `your-folder-id` |
| Folder structure | `Submissions/<ChapterName>/<TeamName>/` |

---

## Cloudflare

**What it does**: DNS for your domain, Turnstile CAPTCHA on all public forms.

| Field | Value |
|-------|-------|
| Account email | `your-admin@your-org.com` |
| Domain | `your-domain.com` |
| Dashboard | https://dash.cloudflare.com |

### Turnstile Widget

| Field | Value |
|-------|-------|
| Site Key | `your-turnstile-site-key` |
| Secret Key | _(stored in Vercel env vars as `TURNSTILE_SECRET_KEY`)_ |

---

## Upstash

**What it does**: Redis database for rate limiting on auth, registration, uploads, and email sending.

| Field | Value |
|-------|-------|
| Provisioned via | Vercel Marketplace (auto-linked) |
| Dashboard | https://console.upstash.com |
| Env vars | `KV_REST_API_URL`, `KV_REST_API_TOKEN` (auto-injected by Vercel) |

**Important**: If rate limiting silently stops working, check the Upstash dashboard for daily command quota exhaustion. The app fails open (no rate limiting) when Redis is unavailable.

---

## OpenRouter

**What it does**: Provides access to multiple LLM models for the AI code review pipeline.

| Field | Value |
|-------|-------|
| Account email | `your-admin@your-org.com` |
| Dashboard | https://openrouter.ai/keys |
| Plan | Pay-per-use |

**Cost**: ~$0.10-0.30 per code review. Budget ~$10-30 per chapter (100 submissions).

---

## Email (SMTP)

**What it does**: Sends all transactional emails (welcome, verification codes, acceptance, certificates, etc.).

| Field | Value |
|-------|-------|
| Account | `your-smtp@your-org.com` |
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `465` |

**Important**: Gmail requires an "App Password" (not the account password) when 2FA is enabled. Generate at: Google Account > Security > App Passwords.

**Gmail sending limits**: 500 emails/day for Google Workspace, 100/day for free Gmail.

---

## Troubleshooting Decision Tree

```
Problem: Site is down
  -> Check Vercel dashboard for deployment errors
  -> Check Vercel function logs for runtime errors

Problem: Users can't log in
  -> Participants: Check Supabase Auth dashboard
  -> Admins: Check Google OAuth config in Supabase
  -> Jury: Check magic link email delivery (SMTP)

Problem: Emails not arriving
  -> Check SMTP credentials in Vercel env vars
  -> Check Gmail App Password hasn't expired
  -> Check Upstash rate limit quota (email limiter)
  -> Check spam folders

Problem: File uploads failing
  -> Check Google Drive service account credentials
  -> Check Drive storage quota
  -> Check server action body limit (4MB max)

Problem: Rate limiting not working
  -> Check Upstash dashboard for daily command quota
  -> Check KV_REST_API_URL and KV_REST_API_TOKEN env vars

Problem: Code reviews not running
  -> Check OpenRouter credit balance
  -> Check GitHub Actions secrets
  -> Check LIMIT_CODE_REVIEW_QUEUE_DEPTH if queue is full

Problem: CAPTCHA not showing
  -> Check NEXT_PUBLIC_TURNSTILE_SITE_KEY env var
  -> Check Turnstile widget config in Cloudflare (allowed domains)
  -> In development, Turnstile is auto-skipped

Problem: Data appears truncated
  -> Check the yellow LimitBanner on the page
  -> Increase the relevant LIMIT_* env var in Vercel
  -> Redeploy after changing env vars
```
