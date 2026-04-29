# EHL Platform: Security Architecture

How the platform is defended. Read this before making changes that touch auth, data access, or user input.

---

## Table of Contents

1. [Authentication Model](#1-authentication-model)
2. [Authorization and Data Access](#2-authorization-and-data-access)
3. [Input Validation](#3-input-validation)
4. [Rate Limiting](#4-rate-limiting)
5. [Cryptography](#5-cryptography)
6. [HTTP Security Headers](#6-http-security-headers)
7. [File Upload Security](#7-file-upload-security)
8. [Audit Logging](#8-audit-logging)
9. [Query Limits](#9-query-limits)
10. [Service Tier Limits](#10-service-tier-limits)
11. [Attack Surface Summary](#11-attack-surface-summary)

---

## 1. Authentication Model

Three strictly separated auth flows. They must NEVER cross.

| Role | Method | Login Page | How it works |
|------|--------|------------|-------------|
| **Admin** | Google OAuth | `/admin/login` | Google redirects to Supabase, Supabase redirects to `/auth/callback`. Email checked against `admin_emails` DB table + `ADMIN_FALLBACK_EMAILS` env var. |
| **Jury** | Email magic link | `/jury/login` | Supabase sends a magic link email. Clicking it authenticates via `/auth/callback`. Access checked against `jury_assignments` table. |
| **Participant** | Email + password | `/login`, `/register` | Standard Supabase email/password auth. Registration requires email verification via encrypted code. |

### Why this matters
- An attacker who compromises a participant account cannot access admin or jury functions
- Admin access requires both a valid Google account AND being on the email allowlist
- Jury access requires an explicit admin invitation (no self-registration)

---

## 2. Authorization and Data Access

### Row Level Security (RLS)

RLS is enabled on **every table** in the database. This is the primary data access control.

- **Participant requests** use the authenticated Supabase client (`createClient()` from `lib/supabase/server.ts`), which respects RLS policies
- **Admin operations** use `createAdminClient()` which bypasses RLS with the service role key
- **Read-only query modules** (`lib/queries/`) may use `createAdminClient()` for server-side data fetching when RLS would be too restrictive (e.g. public team pages reading member names). These are safe because they are server-only, read-only, and select only non-sensitive fields.
- **Rule**: Never use `createAdminClient()` for write operations in participant-facing code paths
- **Profiles table**: RLS restricts reads to authenticated users only (`auth.uid() is not null`, migration 00028). Anonymous API access (anon key without session) cannot read profiles. Fine-grained authorization (admin, jury, team membership) is enforced at the application level.

### Server Action Guards

Every server action follows this pattern:

```
1. Check authentication (is user logged in?)
2. Check authorization (is user allowed to do this?)
3. Validate input
4. Perform operation
5. Return result
```

- Admin actions call `requireAdminAction()` first
- Participant actions verify the user owns the resource (e.g. is a member of the team)
- Jury actions verify the user is assigned to the relevant challenge

### API Route Guards

- Admin API routes check the session and email allowlist
- Cron routes use Bearer token auth (`CRON_SECRET`)
- Certificate routes require session auth (team member or admin) and only serve published scores
- Jury API routes check both session and role (jury or admin)

---

## 3. Input Validation

### Where validation happens

| Boundary | What's validated |
|----------|-----------------|
| Server actions | Type checks, length limits, allowed values. All user input at the entry point. |
| API routes | Request body parsing, parameter validation |
| Turnstile | CAPTCHA on all public forms (login, register, apply, password reset, jury login) |
| Database constraints | Unique constraints, foreign keys, NOT NULL |

### What's NOT trusted
- Any data from `params` or `searchParams` (URL manipulation)
- Form data from client components
- File uploads (MIME type validated server-side)
- Redirect targets from user input (must start with `/` and not `//`)

---

## 4. Rate Limiting

Powered by Upstash Redis. All limiters use sliding window algorithm.

| Limiter | Limit | Window | Protects |
|---------|-------|--------|----------|
| `authLimiter` | 5 requests | 60 seconds | Login, password reset |
| `registerLimiter` | 3 requests | 60 seconds | Registration |
| `resetLimiter` | 3 requests | 60 seconds | Password reset |
| `applicationLimiter` | 3 requests | 60 seconds | Application submission |
| `uploadLimiter` | 10 requests | 1 hour | File uploads |
| `emailLimiter` | 3 per address | 1 hour | Email sending (per recipient) |
| `apiLimiter` | 1,000 requests | 60 seconds | General API endpoints (high: 500+ participants share one WiFi) |
| `certLimiter` | 10 requests | 60 seconds | Certificate PDF generation (CPU-intensive) |

### Fail-open behavior with in-memory fallback

If Redis is unavailable (connection error, quota exceeded), an **in-memory sliding window** takes over (30 requests per minute per identifier). This provides basic protection even without Redis, though it is not shared across serverless instances. The system never fully disables rate limiting.

### Monitoring

Upstash free tier: 10,000 commands/day. At ~500 users, auth flows use ~2,000-5,000 commands/day. If rate limiting silently stops working, check the Upstash dashboard for quota exhaustion.

---

## 5. Cryptography

### Verification Code Passwords

During registration, users receive a verification code by email. The temporary password is encrypted server-side before storage:

- **Algorithm**: AES-256-GCM
- **Key**: `VERIFICATION_ENCRYPTION_KEY` env var (falls back to `SUPABASE_SERVICE_ROLE_KEY`)
- **Implementation**: `lib/crypto.ts`
- **Plaintext passwords are NEVER stored**, not even temporarily

### Supabase Auth

- Passwords are hashed by Supabase (bcrypt)
- JWTs are signed by Supabase with the project's JWT secret
- Session tokens are stored in HTTP-only cookies via `@supabase/ssr`

---

## 6. HTTP Security Headers

Applied to all routes via `next.config.ts`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS for 2 years |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables sensitive browser APIs |

### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <SUPABASE_URL>;
font-src 'self';
connect-src 'self' <SUPABASE_URL> https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com;
object-src 'none';
base-uri 'self'
```

The Supabase URL is injected dynamically from `NEXT_PUBLIC_SUPABASE_URL` at build time (see `next.config.ts`).

**Allowed external domains:**
- Supabase project URL: Database API calls, image hosting
- `challenges.cloudflare.com`: Turnstile CAPTCHA widget
- `youtube.com`, `youtube-nocookie.com`: Embedded videos

---

## 7. File Upload Security

### MIME Type Whitelist

Only these file types are accepted for image uploads:
- `image/png`
- `image/jpeg`
- `image/webp`
- `image/avif`

**SVG is explicitly blocked** (XSS risk via embedded scripts).

### Upload Paths

| Upload type | Storage | Size limit |
|-------------|---------|-----------|
| CVs (application) | Google Drive | 4MB (server action body limit) |
| Submission files | Google Drive | 20MB (API route, validated server-side) |
| Partner logos | Supabase Storage | 4MB (server action body limit) |
| Chapter photos | Google Drive | 4MB (server action body limit) |
| Challenge briefs | Google Drive | 4MB (server action body limit) |

### Validation

- MIME type checked server-side before storage
- File size enforced by Next.js server action body limit (4MB) or API route validation (20MB for submissions)
- Filenames sanitized before storage

---

## 8. Audit Logging

All admin actions are logged to the `admin_audit_log` table:

| Column | Description |
|--------|-------------|
| `action` | What happened (e.g. `update_chapter_status`, `publish_scores`, `send_certificates`) |
| `entity_type` | What was affected (e.g. `chapter`, `team`) |
| `entity_id` | ID of the affected entity |
| `performed_by` | User ID of the admin |
| `details` | JSON with context (previous values, etc.) |
| `created_at` | Timestamp |

All admin state-changing operations are audit logged via a shared `auditLog()` helper in `lib/actions/admin.ts`. The audit log table has an immutability policy (migration 00025): rows cannot be updated or deleted.

---

## 9. Query Limits

Every database query that could return unbounded rows has a configurable limit. This prevents:
- Memory exhaustion from large result sets
- Slow queries from scanning too many rows
- Accidental data exposure

### How limits work

1. All limits are defined in `lib/config/limits.ts` as `QUERY_LIMITS`
2. Each limit has a default value and an env var override (e.g. `LIMIT_TEAMS=500`)
3. When a query hits its limit, the UI shows a yellow `LimitBanner` warning
4. Users are NEVER shown silently truncated data

### Current defaults

| Limit | Default | Env var |
|-------|---------|---------|
| Teams | 500 | `LIMIT_TEAMS` |
| All team members | 2,500 | `LIMIT_ALL_TEAM_MEMBERS` |
| Profiles | 1,000 | `LIMIT_PROFILES` |
| Applications per chapter | 2,000 | `LIMIT_APPLICATIONS_PER_CHAPTER` |
| Application stats | 5,000 | `LIMIT_APPLICATION_STATS` |
| Screening scores | 5,000 | `LIMIT_SCREENING_SCORES` |
| Scores | 1,000 | `LIMIT_SCORES` |
| Leaderboard | 500 | `LIMIT_LEADERBOARD` |
| Media | 200 | `LIMIT_MEDIA` |
| Submissions per challenge | 200 | `LIMIT_SUBMISSIONS_PER_CHALLENGE` |
| Code reviews per challenge | 200 | `LIMIT_CODE_REVIEWS_PER_CHALLENGE` |
| Chapter unlocks | 500 | `LIMIT_CHAPTER_UNLOCKS` |
| Challenge registrations | 500 | `LIMIT_CHALLENGE_REGISTRATIONS` |
| Users looking for team | 500 | `LIMIT_USERS_LOOKING_FOR_TEAM` |
| Code review queue depth | 200 | `LIMIT_CODE_REVIEW_QUEUE_DEPTH` |

### Admin visibility

Current limit values are visible at **Admin > Settings > Query Limits** with instructions on how to change them.

---

## 10. Service Tier Limits

External service limits that affect the platform. If you hit unexplained errors (timeouts, 429s, storage full), check these first.

### Vercel (Pro, $20/mo)
- Function timeout: 60s (was 10s on Hobby)
- Bandwidth: 1TB/mo
- Serverless function executions: unlimited

### Supabase (Free tier)
- Database: 500MB storage
- Auth: 50,000 monthly active users
- Storage: 1GB file storage
- API requests: unlimited but 500 concurrent connections
- Realtime: 200 concurrent connections
- Edge functions: 500,000 invocations/mo
- **Watch out**: Database approaching 500MB triggers warnings

### Upstash Redis (Free tier via Vercel Marketplace)
- Commands: 10,000/day
- Storage: 256MB
- **Watch out**: At 500 users, auth flows use ~2,000-5,000 commands/day. If rate limiting stops working silently, check the daily command limit.

### Cloudflare Turnstile (Free)
- 1M siteverify calls/mo (effectively unlimited for our scale)

### Google Cloud
- OAuth: Unlimited in production mode (100 in testing mode)
- Gmail API: 250 quota units/second

### OpenRouter (pay-per-use)
- No rate limit, cost scales with usage
- ~$0.10-0.30 per code review
- Budget for 100 reviews/chapter: ~$10-30

### GitHub
- API rate limit: 5,000 requests/hour (authenticated)
- Actions: 2,000 minutes/mo (free for public repos)

---

## 11. Attack Surface Summary

| Attack vector | Defense |
|---------------|---------|
| Brute-force login | Rate limiting (5/min) + Turnstile CAPTCHA |
| Brute-force registration | Rate limiting (3/min) + Turnstile + email verification |
| SQL injection | Supabase client parameterizes all queries |
| XSS | CSP headers + React's built-in escaping + SVG upload blocked |
| CSRF | Supabase uses SameSite cookies + server actions use POST |
| Clickjacking | X-Frame-Options: DENY |
| Open redirect | Redirect targets validated (must start with `/`, not `//`) |
| Privilege escalation | RLS on all tables + server-side auth checks + separated auth flows + DB trigger blocks role changes (migration 00030) |
| Late submission | `is_locked` enforced at RLS level (migration 00031) + application-level deadline check |
| Data scraping | Rate limiting on API + query limits on all queries |
| Email enumeration | Rate limiting on account/team lookup server actions |
| Email bombing | 3 emails/hour per address rate limit |
| File upload abuse | MIME whitelist + size limits (4MB server actions, 20MB submissions) + rate limiting |
| JWT manipulation | JWTs signed by Supabase, validated server-side |
| Admin impersonation | Google OAuth only + email allowlist (DB + env var) |
| Jury vote manipulation | INSERT-only voting (no updates after submission) |
| Audit log tampering | Immutable audit log (no UPDATE/DELETE policy) |
