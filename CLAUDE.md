# EHL Website

European Hackathon League platform, Season 1. Built by Julian Sikora (TUM.ai).

> **Extended docs**: See `docs/` for detailed guides:
> - `docs/SETUP.md` — Full deployment guide from scratch (all services, env vars, scaling)
> - `docs/TESTING.md` — E2E test architecture, extension guide, troubleshooting
> - `docs/FEATURES.md` — Complete feature list by user role
> - `docs/SECURITY.md` — Security architecture, defenses, limits
> - `docs/ACCOUNTS.template.md` — Service account directory template (fill in for your deployment)

## Tech Stack
- **Framework**: Next.js 15 (App Router, TypeScript, Server Components)
- **Styling**: Tailwind CSS v4 (CSS-based config in `globals.css`, NO `tailwind.config.ts`)
- **Database**: Supabase (Postgres + Auth + Storage)
- **File Storage**: Google Drive (CVs, submissions, briefs, photos) + Supabase Storage (partner logos only)
- **Email**: Nodemailer + React Email templates (all EHL branded, never default Supabase templates)
- **Code Reviews**: Multi-agent AI pipeline via OpenRouter, executed in GitHub Actions
- **Rate Limiting**: Upstash Redis (Vercel Marketplace)
- **CAPTCHA**: Cloudflare Turnstile
- **Certificates**: @react-pdf/renderer (PDF generation)
- **Package Manager**: pnpm
- **Hosting**: Vercel (Pro plan, 60s function timeout)

## Commands
- `pnpm dev` — start dev server (Turbopack)
- `pnpm build` — production build
- `pnpm start` — serve production build
- `pnpm test` — run unit tests (Vitest)
- `pnpm test:e2e:lifecycle` — run full lifecycle E2E test (against test Supabase)
- `pnpm test:e2e` — run all E2E tests (setup + lifecycle + smoke + cleanup)
- `pnpm test:setup-db` — apply migrations + seed to test database
- `pnpm test:setup-supabase` — full automated test Supabase setup (needs SUPABASE_ACCESS_TOKEN)

## Architecture

### Route Groups
```
app/
  (public)/       — Public pages with Nav + Footer layout (landing, chapters, leaderboard, rules, partners, register, login, apply)
  (participant)/  — Auth-required participant pages (dashboard, event hub)
  admin/          — Admin panel (separate light-theme layout with sidebar)
  jury/           — Jury evaluation interface (magic link auth)
  api/            — REST API endpoints
  auth/callback/  — OAuth/magic link callback handler
```

### Authentication (strictly separated, never cross)
| Role | Auth Method | Login Page | Guard |
|------|-------------|------------|-------|
| Admin | Google OAuth only | `/admin/login` | `requireAdmin()` checks email allowlist |
| Local (chapter) admin | Google OAuth only | `/admin/login` | `chapter_admins` table check (scoped to one chapter) |
| Jury | Email magic link only | `/jury/login` | `jury_assignments` table check |
| Participant | Email + password | `/login`, `/register` | Supabase session + RLS |

Admin access: `admin_emails` DB table + `ADMIN_FALLBACK_EMAILS` env var.

Local (chapter) admins: invited per-chapter by a global admin (`inviteChapterAdmin`,
profile role `chapter_admin` + a `chapter_admins` row). They log in via Google OAuth
like global admins (the `/auth/callback` `/admin` branch recognizes them by their
`chapter_admins` row, so no `ADMIN_EMAIL_DOMAIN` change is needed for external
partners). They are confined — by middleware plus page/action/API guards
(`requireChapterAdminPage/Action/Api`, `requireGlobalAdminPage`) — to a single
chapter: screening, that chapter's teams/submissions, and check-in. They can score
applications and check people in, but cannot see other chapters or any global admin
view, nor edit chapter settings, publish scores, or delete.

### Data Flow
- **Read queries**: `lib/queries/` (split by domain: chapters, teams, challenges, submissions, jury, profiles)
- **Write actions**: `lib/actions/` (Next.js server actions with `"use server"`)
- **API routes**: `app/api/` (for non-form operations: file uploads, cron, external integrations)
- **Mappers**: `lib/queries/mappers.ts` converts DB rows to domain types from `lib/types.ts`
- **Re-export index**: `lib/queries/index.ts` re-exports everything so `import { ... } from "@/lib/queries"` works
- **Query limits**: `lib/config/limits.ts` centralizes all query limits with env var overrides

### Key Integrations
- **GitHub** (`lib/github.ts`): Fork participant repos for snapshot, sync upstream, invite jury collaborators
- **Google Drive** (`lib/gdrive.ts`): Upload/download files with folder hierarchy (Submissions/ChapterName/TeamName/)
- **OpenRouter** (`lib/code-review/`): Multi-agent code review pipeline (tech desc, code quality, highlights, originality, coordinator)
- **Email** (`lib/email.ts` + `lib/emails/`): SMTP with inline EHL logo, React Email templates for all transactional emails
- **Turnstile** (`lib/turnstile.ts`): CAPTCHA verification on all public forms
- **Rate Limiting** (`lib/ratelimit.ts`): 13 limiters via Upstash Redis, in-memory fallback when Redis unavailable

### Chapter Status Flow
```
draft -> announced -> applications_open -> screening -> registration_open -> submissions_open -> pitching -> completed
```
Status transitions are controlled by admins via status control panel. Some transitions are automated by the cron endpoint (`/api/cron/deadline-check`).

### Scoring
Defined in `lib/scoring.ts`. Placement points: 1st=8, 2nd=7, 3rd=6, 4th-5th=4, participated=2. Season leaderboard aggregates across matches.

## Database

61 sequential migrations in `supabase/migrations/`. Key tables:
- `profiles` (users; a trigger on `auth.users` auto-creates a profile for every
  account so no code path can leave an auth user profileless, migration 00055),
  `teams`, `team_members`, `team_invites`, `team_join_requests`
- `chapters` (matches), `challenges`, `challenge_registrations`
- `submissions`, `code_reviews`
- `jury_assignments`, `jury_rankings`, `jury_feedback`
- `applications`, `application_notes` (admin notes history), `screening_scores`, `verification_codes`, `participant_flags`
- `scores`, `partners`, `media`
- `chapter_communications` (admin-only per-chapter acceptance-email subject/message +
  event info; a SEPARATE table, never on the publicly-readable `chapters` row),
  `chapter_broadcasts` (broadcast email history)
- `chapter_walk_in` (admin-only per-chapter unguessable walk-in registration token; a
  SEPARATE table, never on the publicly-readable `chapters` row, mirroring
  `chapter_communications`)
- `chapter_partner_showcase` (admin-only per-chapter unguessable sponsor showcase token +
  settings: is_enabled, show_cvs, expires_at; a SEPARATE table, never on the
  publicly-readable `chapters` row, mirroring `chapter_walk_in`)
- `chapter_certificate_designs` (admin-only per-chapter custom certificate background
  designs, one row per chapter+variant; images live in the PRIVATE
  `certificate-backgrounds` storage bucket; a SEPARATE table, never on the
  publicly-readable `chapters` row)
- `admin_emails`, `chapter_admins` (local/chapter admins), `app_settings`, `admin_audit_log`
- `leaderboard` (Postgres VIEW, not a table)

RLS is enabled on all tables. Admin operations use `createAdminClient()` which bypasses RLS.

### Verifying migrations are applied (catches "code shipped, migration didn't")
Migrations here are applied ad-hoc via the Management API (`scripts/db-migrate.sh`,
`apply-migrations-via-api.ts`), so there is no `schema_migrations` ledger. To confirm a
database actually has every migration, run:
```
pnpm db:check          # PRODUCTION (default)
pnpm db:check:test     # test instance
```
This runs one read-only probe per migration (in `scripts/migration-checks.ts`) against the
live catalog and reports any that are missing. A red E2E test on a feature branch is often
just a migration that never reached the target DB: run `db:check` before assuming app-code
is at fault.

Two layers run automatically in CI (`.github/workflows/test.yml`, `checks` job):
- **Unit test** (`tests/migration-checks.test.ts`, runs in `pnpm test`, no DB needed): fails
  if a migration file has no manifest entry. This is the guard that enforces the rule below.
- **Live test-DB check**: runs `check-migrations-applied.ts` against the test Supabase. Only
  runs when the `SUPABASE_ACCESS_TOKEN` + `SUPABASE_TEST_REF` repo secrets are set; skipped
  otherwise so it never blocks forks. Production is checked manually with `pnpm db:check`.

A migration with no independently observable artifact (its effect is reverted or absorbed
by a later migration, or it is a defensive `... IF EXISTS` no-op) has nothing to probe. Mark
it `unverifiable: { reason, coveredBy? }` instead of `sql` — the runner reports it as
UNVERIFIABLE (never failed on), and `coveredBy` names the later migration whose probe
verifies the net schema state.

**RULE (NON-NEGOTIABLE): every new migration MUST add a matching entry to
`scripts/migration-checks.ts` in the same PR**, keyed by its file prefix, asserting the
most distinctive artifact it introduces (table, column, constraint, enum value, policy,
index, function, or view fragment). A unit test (`tests/migration-checks.test.ts`) fails if
a migration file has no manifest entry, so this cannot be silently skipped.

### E2E runs on an EPHEMERAL local Supabase (clean-room migration ordering)
The CI E2E + cross-browser jobs (`.github/workflows/test.yml`) boot their OWN per-job
Supabase via the CLI (`supabase start`, config in `supabase/config.toml`), apply
`supabase/migrations/*` to a fresh DB, then seed with `pnpm test:seed-local`
(`scripts/seed-local.ts`). This gives every CI run a fully isolated database, so E2E runs
go PARALLEL across branches/PRs (there is no shared remote test DB to corrupt, so no
cross-branch serialization). The remote test Supabase is now used only for the optional
`check-migrations-applied.ts` step and manual runs — NOT for E2E.

Consequence for migrations: `supabase start` applies each migration file in its OWN
transaction and in strict filename order, which is stricter than the ad-hoc Management-API
path. Two rules follow:
- **A newly `ALTER TYPE ... ADD VALUE`'d enum value cannot be USED in the same migration
  file** (Postgres 55P04). Add the value in one file; use it (UPDATE/insert literals) in a
  later file. (This is why 00008's data UPDATE was split into 00053.)
- **No migration may reference an object created by a LATER migration.** Strict ordering
  means a forward reference fails on a clean apply even if it happened to work against a DB
  that had the object created ad-hoc earlier. Guard such statements with
  `do $$ begin if to_regclass('public.<table>') is not null then ... end if; end $$;` (see
  00011 / 00020 for `verification_codes`).

To run the stack locally: `supabase start` then `pnpm test:seed-local`, point your dev
server at the printed local URL/keys, and run `pnpm test:e2e:lifecycle`. See `docs/TESTING.md`.

## Project Structure
```
lib/
  actions/              — Server actions (registration, teams, submissions, jury, admin, applications, event, auth, screening, flags, communications, showcase)
  queries/              — DB queries split by domain (chapters, teams, challenges, submissions, jury, profiles, showcase)
  emails/               — React Email templates (layout.tsx shared, individual templates, text-block.ts for safe plain-text rendering)
  certificates/         — PDF certificate template + design-guide (@react-pdf/renderer), layout.ts (fixed text positions), designs.ts (custom background loading)
  code-review/          — AI review pipeline (ingest, openrouter, pipeline, prompts)
  config/               — Centralized configuration (limits.ts with env var overrides)
  supabase/             — Client configs (client.ts, server.ts, admin.ts, middleware.ts)
  crypto.ts             — AES-256-GCM encryption for verification code passwords
  github.ts             — GitHub API integration
  gdrive.ts             — Google Drive API integration
  turnstile.ts          — Cloudflare Turnstile CAPTCHA verification
  ratelimit.ts          — Upstash Redis rate limiters (13 limiters) + in-memory fallback
  flag-utils.ts         — LinkedIn/GitHub username extraction, name normalization for flag matching
  scoring.ts            — Point calculations
  showcase-shared.ts    — Partner-showcase consent predicate + derived SQL filter + types
  drive-urls.ts         — Client-safe Google Drive photo URL builders (thumbnail, viewer)
  report-client-error.ts — Shared error-boundary reporter (redacts secret URL tokens before any sink)
  types.ts              — All domain types
  utils.ts              — cn(), formatDate(), slugify(), getPlacementLabel(), redactSecretTokens()

components/
  ui/                   — Primitives: Button, Card, Badge, Section, Toggle, Accordion, BracketCard, LimitBanner
  layout/               — Navbar, Footer, MobileNav
  landing/              — Hero, HowItWorks, TourTimeline, LeaderboardPreview, PartnersBar, MediaTeaser
  chapter/              — ChapterCard + status-specific detail views
  leaderboard/          — Podium, Table, ScoringExplainer
  dashboard/            — TeamManagement, TeamlessView
  event/                — EventHub, TeamSelector, ChallengeSelector, JoinRequestManager
  submission/           — SubmissionForm, DeadlineCountdown
  code-review/          — ReportCard
  showcase/             — Partner showcase view (token-gated sponsor page)
  admin/                — Sidebar, LimitBanner (light theme)

public/
  images/               — EHL logos (ehl-logo.svg, ehl-logo.png)
  makeathon/            — Makeathon event images
  partners/             — Partner logo source files (not used in code, stored in Supabase Storage)

docs/
  SETUP.md              — Full deployment guide from scratch
  FEATURES.md           — Complete feature list
  SECURITY.md           — Security architecture
  ACCOUNTS.md           — Service account directory
```

## Critical Rules (read these before making any changes)

### Public Repo Awareness (THIS REPO IS PUBLIC)
This is an **open-source public repository**. Every commit, branch name, PR title, PR description, and commit message is visible to the world. Treat accordingly:
1. **Never include real credentials, API keys, tokens, internal URLs, or Supabase project refs** in code, commits, or PR descriptions.
2. **Never include internal org details** (account emails, service mappings, infrastructure specifics) in commits or code.
3. **Commit messages must be clean.** No references to internal tickets, personal emails, or org-specific context. Write them as if a stranger reads them.
4. **PR descriptions are public.** Don't paste error logs containing env vars, database URLs, or user data.
5. **Branch names are public.** Use descriptive feature names, not internal project codes.
6. Org-specific context belongs in `.claude/CLAUDE.md` (gitignored) or the private `ehl-ops` repo, never in tracked files.

### Security (breaking these creates vulnerabilities)
1. **Never use `createAdminClient()` in participant-facing paths.** Use the authenticated server client so RLS applies. This is the #1 most dangerous mistake.
2. **Admin actions must call `requireAdminAction()` or `requireAdmin()`** before any DB operation. No exceptions.
3. **Three auth flows are strictly separated.** Admin = Google OAuth. Jury = magic link. Participant = email + password. Never cross them.
4. **Never commit secrets.** No API keys, tokens, passwords in code. All credentials go in env vars. Run `git diff --cached` before every commit.
5. **Validate all user input at the boundary.** Check types, lengths, allowed values. Don't trust `as` casts on user data.
6. **File uploads: MIME whitelist only.** PNG, JPEG, WebP, AVIF. Never allow SVG (XSS risk).
7. **Redirect validation:** Any redirect from user input must start with `/` and not `//` (open redirect prevention).
8. **Jury votes are INSERT-only.** Once submitted, votes cannot be changed. This is enforced in code and by design.

### Data Integrity (breaking these causes silent bugs)
1. **All query limits must come from `QUERY_LIMITS`** in `lib/config/limits.ts`. Never hardcode limit numbers.
2. **Every limited query must show a `LimitBanner`** when the limit is hit. Users must never see silently truncated data.
3. **Null safety on Supabase results.** `.single()` returns null if no row. Don't chain `.property` on potentially null results.
4. **Date handling:** Always append `T00:00:00` when creating `Date` objects from date-only strings to avoid timezone shifts.
5. **The `leaderboard` is a VIEW**, not a table. You cannot insert/update it directly.
6. **Upload size limits must come from `lib/config/upload-limits.ts`** and must stay under
   `PLATFORM_REQUEST_BODY_LIMIT_BYTES`. Vercel rejects bodies over ~4.5MB at the edge,
   before middleware and before any server action or route handler runs, and
   `bodySizeLimit` in `next.config.ts` cannot raise it. Consequences: a size check inside
   a server action can never produce a message for an oversized upload (the function is
   never reached, so the client-side guard is the only one that can speak), and advertising
   a larger cap ships a promise the platform silently breaks. To accept files above the
   platform limit, the bytes must bypass the function entirely (direct browser-to-storage
   upload). Raising the number alone only relocates the silent failure.

### Code Style
- Server Components by default. Only `"use client"` when interactive (forms, toggles, state)
- No external UI libraries (no shadcn, no Radix). All components are custom.
- Never use em dashes in user-visible text. Use colons, commas, or periods.
- Size logos by equal height (`h-{size} w-auto object-contain`), never distort aspect ratio
- Partners are per-match (linked via `chapter_id`), not global sponsors

### Email
- Every email must use the EHL branded layout from `lib/emails/layout.tsx`. Never send plain text or default Supabase templates.
- Verification code emails are awaited (blocking). All other transactional emails (confirmations, invites, welcome) must be sent via `sendEmailAfterResponse()` from `lib/email-deferred.ts`. Never use floating promises for emails: on Vercel the function freezes after the response and un-awaited sends are silently dropped.
- Add new email templates to `lib/emails/`, add render function to `lib/emails/render.ts`.

### Admin Panel
- Admin dashboard uses a light theme. Never switch it to dark-only.
- Admin components use `ad-*` class prefixes for light-theme styling.

### Test Discipline (NON-NEGOTIABLE)

**Tests are part of every change (NON-NEGOTIABLE):** any code change MUST update every
existing test it affects, AND add new tests covering any new feature/behavior. A change
that touches behavior without touching tests is incomplete. No exceptions.

**Workflow for every code change** (feature, bugfix, refactor):
1. Identify the behavior guarantee to test. If unclear, ask.
2. For bugfixes: write a test that reproduces the bug FIRST (must fail before the fix).
3. Implement/change the code.
4. Update any tests the change affects; add tests for any new behavior.
5. Run ALL checks: `pnpm typecheck && pnpm test && pnpm build`
6. Run E2E: `pnpm test:e2e:lifecycle` (pre-commit hook runs unit tests automatically)
7. Report: which tests added/updated, which pass, which edge cases covered/not covered.

**Absolute prohibitions** (STOP and ask the user if you would violate these):
1. **Never change a failing test to make it pass.** Default: the code is wrong, not the test. If the test is genuinely wrong, STOP and ask: "Test X seems wrong because [reason]. May I change it?"
2. **Never weaken assertions** (`toBe` to `toBeTruthy`, specific values to "any non-null", `toEqual` to `toContain`).
3. **Never commit `.skip`, `.only`, `xit`, `xdescribe`, or commented-out tests.** The pre-commit hook blocks this.
4. **Never mark a feature as done without tests** when it introduces new behavior.
5. **Never bypass the pre-commit hook** (`--no-verify`) without explicit user instruction.
6. **Never delete tests** without explaining in the commit message why the tested behavior no longer exists.

**E2E test specifics:**
- Tests run against a separate test Supabase (`.env.test`), never production
- Test cases are append-only. Add at the end of the relevant block in `hackathon-lifecycle.spec.ts`
- Use `data-factory.ts` helpers and `auth.ts` constants, never hardcode IDs/emails
- API fallbacks after UI actions are OK (check DB, insert via API if UI didn't save)
- See `docs/TESTING.md` for the full architecture and extension guide

**What to test per feature:**
- Happy path: correct input produces correct result
- Error path: invalid input shows correct error
- Authorization: unauthorized user cannot access the feature
- DB state: correct data is persisted

### Documentation (keep docs in sync with code)
When a code change affects any of the following, update the corresponding docs in the same commit:
- **New feature/flow**: Update `docs/FEATURES.md` with what it does and which roles can use it
- **New env var**: Add to `.env.local.example` and `docs/SETUP.md` Section 10
- **New migration**: Update migration count in `CLAUDE.md` Database section AND add a probe entry to `scripts/migration-checks.ts` (the `db:check` manifest; a unit test enforces this)
- **Changed auth/security**: Update `docs/SECURITY.md`
- **New/changed API route or action**: Update Architecture section in `CLAUDE.md` if it changes the data flow
- **New test pattern**: Update `docs/TESTING.md` if it introduces a new testing approach
- **New external service**: Add to `docs/ACCOUNTS.md` and `docs/SETUP.md`
- **Changed project structure**: Update the Project Structure tree in `CLAUDE.md`

### After Making Changes
- The pre-commit hook runs typecheck + unit tests automatically
- Always run `pnpm test:e2e:lifecycle` before considering work complete
- Always run `pnpm build` to verify the build passes
- Review your own changes for: potential bugs, performance issues, security vulnerabilities, correctness
- Check if any documentation needs updating (see Documentation section above)
- See `RULES.md` for the full review checklist
- See `docs/SECURITY.md` for the security architecture if your changes touch auth, data access, or user input

## Design System
- **Public site**: Dark only. Background `#0B0B1A`, cards `#1A1A3A`
- **Admin panel**: Light theme
- **Gold** (`#E8B84B`): scores, CTAs, highlights, EHL logo accent
- **Purple** (`#9B59B6`): structural elements, corner brackets, secondary accent
- **Fonts**: Satoshi (sans-serif, self-hosted), JetBrains Mono (monospace for scores)
- **Custom Tailwind classes**: `bg-surface-deep`, `bg-surface-card`, `text-gold`, `text-purple`, `text-text-secondary`

## Operator Context (not in this repo)

If you're developing for an existing deployment (not forking fresh), your org should provide these files which are gitignored:

- `docs/ACCOUNTS.local.md` — Service account mapping (who owns what, credentials)
- `.env.local` — Production credentials
- `.env.test` — Test instance credentials
- `.claude/CLAUDE.md` — Org-specific Claude Code context

Your org's ops repo (if it exists) contains the filled-in versions of these files.

## Test Discipline Reminder (these rules ALWAYS apply)

- Failing tests are fixed by changing application code, never by changing the test
- No assertion weakening without explicit user approval
- No `.skip` / `.only` / commented-out tests (pre-commit hook blocks this)
- No feature is done without tests for its new behavior
- No `--no-verify` without explicit user instruction
- Self-check before "done": which tests added? which pass? which edge cases covered?
