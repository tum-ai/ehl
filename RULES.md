# Development Rules

Standards and review checklist for the EHL codebase. These rules exist because of real bugs discovered during security audits. Follow them to prevent regressions.

## Pre-Commit Checklist

Before every commit, review your staged changes (`git diff --cached`). Do not skip this step.

- [ ] **No credentials**: No API keys, tokens, passwords, or connection strings in the diff. Grep for patterns like `ghp_`, `sk-`, `sb_secret_`, `sb_publishable_`, `password=`, `Bearer `.
- [ ] **No debug leftovers**: No `console.log` debugging, no commented-out code blocks, no `TODO` hacks meant to be temporary.
- [ ] **Correct files staged**: Only intended files are staged. No stray screenshots, `.env` files, or generated artifacts.
- [ ] **Build passes**: Run `pnpm build` and verify it succeeds.
- [ ] **E2E lifecycle passes**: Run `pnpm test:e2e:lifecycle` and verify all tests pass. If a test fails, fix the application code, not the test.
- [ ] **Docs in sync**: If your change adds features, env vars, migrations, API routes, or security-relevant code, update the corresponding docs (`CLAUDE.md`, `docs/SETUP.md`, `docs/FEATURES.md`, `docs/SECURITY.md`, `docs/TESTING.md`).

## E2E Test Policy

The lifecycle test (`e2e/lifecycle/hackathon-lifecycle.spec.ts`) is the primary regression safety net. These rules are strict.

### Extending Tests (encouraged)
- When adding a new feature, add test steps to the relevant block (or create a new block at the end)
- New tests go AFTER existing tests within `test.describe.serial("Hackathon Lifecycle")`
- Use `data-factory.ts` helpers for setup, `auth.ts` for login, `getAdminClient()` for assertions
- API fallbacks after UI actions are encouraged (check DB, insert via API if UI didn't save)

### Modifying Tests (restricted)
- **Never delete a test case.** Tests are append-only.
- **Never weaken an assertion** (e.g., changing `toBe(2)` to `toBeGreaterThan(0)` or adding `.catch()` around expects)
- **Never change expected values** unless the application behavior intentionally changed AND the user explicitly approved
- **Selector updates are OK** (e.g., `getByText("Scores")` to `getByRole("heading", { name: /scores/i })`) when fixing strict-mode violations
- **Timeout increases are OK** when network conditions cause flakiness, but document why

### Test Architecture (prevents breakage)
- The lifecycle test is ONE `test.describe.serial` block with shared module-level variables
- Each test depends on state from previous tests (e.g., `chapterId` set in test 2.2 is used in all later tests)
- **New tests must go AFTER the block they depend on** - inserting in the middle risks breaking the serial chain
- To add a completely independent test, create a new `test.describe` block (not serial) at the bottom of the file
- **Full guide**: See `docs/TESTING.md` for extension patterns, auth strategy, data conventions, and troubleshooting

## Self-Review Categories

After staging, review your changes against these four categories.

### 1. Security

- [ ] **Auth guards**: Every server action and API route that mutates data checks authentication. Admin actions call `requireAdminAction()` or `requireAdmin()`. Participant actions verify the user owns the resource.
- [ ] **No admin client in participant paths**: Never use `createAdminClient()` where a participant's request is being handled. Use the authenticated server client so RLS applies.
- [ ] **Input validation**: Validate all user input at the boundary. Check types, lengths, and allowed values. Don't trust `as` casts on user-provided data.
- [ ] **File uploads**: Validate MIME types against a whitelist before storing. Never allow SVG in public buckets (XSS via embedded scripts). Current whitelist: PNG, JPEG, WebP, AVIF.
- [ ] **No secrets in client code**: Environment variables without `NEXT_PUBLIC_` prefix must never appear in client components. Service role keys, SMTP credentials, and API keys are server-only.
- [ ] **Redirect validation**: Any redirect target from user input must start with `/` and not `//` (open redirect prevention).
- [ ] **Encryption**: Passwords in `verification_codes` are encrypted with AES-256-GCM via `lib/crypto.ts`. Never store plaintext passwords, even temporarily.

### 2. Correctness

- [ ] **Auth flow separation**: Admin = Google OAuth only. Jury = magic link only. Participant = email + password. Never cross these flows.
- [ ] **Null safety**: When accessing Supabase query results, handle `null`/`undefined`. A `.single()` call returns `null` if no row matches. Don't chain `.property` on potentially null results.
- [ ] **Composite primary keys**: Some tables (`jury_assignments`, `jury_feedback`) have composite PKs, not an `id` column. Use the correct columns when selecting or filtering.
- [ ] **Database constraints**: Check if a unique constraint exists before relying on check-then-act patterns. If no constraint exists, document the race condition risk.
- [ ] **Email rendering**: All emails must use the shared layout from `lib/emails/layout.tsx`. Test that email templates render correctly (run `pnpm dev` and check the email preview if available).

### 3. Performance

- [ ] **No N+1 queries**: Don't fetch related data in a loop. Use joins (`.select("*, related_table(*)")`) or batch queries with `.in()`.
- [ ] **Limit queries**: Any query that could return unbounded rows must use a limit from `QUERY_LIMITS` in `lib/config/limits.ts`. Never hardcode limit numbers in query files.
- [ ] **Limit UI feedback**: If a query uses a limit, the UI that displays the results must show a warning when `count >= limit`. Use `LimitBanner` from `components/admin/limit-banner.tsx` (light theme) or `components/ui/limit-banner.tsx` (dark theme). Users must never see silently truncated data.
- [ ] **Image optimization**: Use Next.js `<Image>` with explicit `width`/`height` or `sizes` prop. Never use raw `<img>` tags for remote images.
- [ ] **Body size**: Server action body limit is 4MB. File uploads go through API routes (`/api/admin/upload`, `/api/submissions/upload`), not server actions.

### 4. Potential Bugs

- [ ] **Build passes**: Run `pnpm build` and verify it succeeds. TypeScript errors caught at build time prevent runtime crashes.
- [ ] **Import paths**: When moving or splitting files, verify all import sites are updated. Use `grep` to find references before deleting or renaming.
- [ ] **Server action re-exports**: `"use server"` files cannot re-export from other `"use server"` files. Each server action must be defined in the file that exports it, or consumers must import from the source file directly.
- [ ] **Supabase typing**: Double casts (`as unknown as Type`) on Supabase join results are acceptable but should be limited to mappers in `lib/queries/mappers.ts`.
- [ ] **Date handling**: Always append `T00:00:00` when creating `Date` objects from date-only strings to avoid timezone shifts. See `formatDate()` in `lib/utils.ts`.

## Code Patterns

### Server Actions
```typescript
"use server";

export async function myAction(input: string) {
  // 1. Auth check first
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // 2. Validate input
  if (!input || input.length > 1000) return { error: "Invalid input." };

  // 3. Authorization check (does user own this resource?)
  // 4. Business logic
  // 5. Return { success: true } or { error: "..." }
}
```

### Admin Actions
```typescript
export async function adminAction(id: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const adminClient = createAdminClient();
  // ... admin logic using adminClient (bypasses RLS)
}
```

### Cron/Internal Actions
```typescript
// For functions called by cron (no session auth):
// Create a separate internal function, don't add session checks
export async function lockSubmissions(challengeId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  return lockSubmissionsInternal(challengeId);
}

export async function lockSubmissionsInternal(challengeId: string) {
  // No auth check, called by cron with Bearer token auth
  const adminClient = createAdminClient();
  // ...
}
```

## Credentials Policy

**Never commit secrets, API keys, tokens, or passwords to the repository.** This rule is absolute, no exceptions.

- All credentials go in environment variables, never in source code
- `.env.local` is gitignored and must stay that way
- Use `process.env.VAR_NAME` or the centralized `getSiteUrl()` / `getSettingValue()` helpers
- If a secret is needed at runtime, add it to: Vercel Env Vars, GitHub Actions Secrets, or Supabase `app_settings`
- Before committing, verify with `git diff --cached` that no keys, tokens (`ghp_`, `sk-`, `sb_secret_`, `sb_publishable_`), passwords, or connection strings are included
- If a credential is accidentally committed: rotate it immediately, then clean the history

Current credential locations:
| Where | What |
|-------|------|
| Vercel Env Vars | All production secrets |
| GitHub Actions Secrets | `GH_PAT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` |
| Supabase `app_settings` table | `github_token`, `github_org`, `openrouter_api_key` (runtime-configurable via Admin Panel) |
| `.env.local` (local only) | Developer copy, never committed |

## SEO & Metadata Maintenance

SEO assets must stay in sync with the site. When making changes, check whether any of the following need updating:

### When adding or removing public pages
- [ ] **Sitemap**: Update `app/sitemap.ts` if the page should be indexed. Static pages go in `staticPages`, dynamic pages are generated from DB queries.
- [ ] **robots.ts**: If the new page is auth-gated or internal, add its path to the `Disallow` list in `app/robots.ts`.

### When changing site branding, name, or tagline
- [ ] **Root metadata**: Update `title`, `description`, and `openGraph` in `app/layout.tsx`.
- [ ] **OG image**: Update the text/design in `app/og-image.png/route.tsx` to match the new branding.
- [ ] **JSON-LD**: Update the structured data in `app/(public)/page.tsx` (name, description, cities, etc.).

### When adding or renaming chapters/cities
- [ ] **JSON-LD cities**: Update the `location` array in the homepage JSON-LD schema (`app/(public)/page.tsx`).
- [ ] **Sitemap**: Chapter pages are auto-generated from the DB, but verify the query in `app/sitemap.ts` includes the new data.
- [ ] **OG image cities**: Update the cities line in `app/og-image.png/route.tsx`.

### When changing the domain or base URL
- [ ] **metadataBase**: Update `metadataBase` in `app/layout.tsx`.
- [ ] **Sitemap BASE_URL**: Update `BASE_URL` in `app/sitemap.ts`.
- [ ] **JSON-LD url**: Update the `url` field in the homepage JSON-LD.
- [ ] **Supabase URL Config**: Update Site URL and Redirect URLs in the Supabase dashboard.

### When updating the logo or favicon
- [ ] **icon.svg**: Replace `app/icon.svg` (used as modern favicon).
- [ ] **favicon.ico**: Replace `app/favicon.ico` (legacy fallback).
- [ ] **OG image**: Consider whether `app/og-image.png/route.tsx` needs to reflect the new logo.
- [ ] **JSON-LD logo**: Update the `logo` URL in the homepage JSON-LD.

## Common Mistakes to Avoid

1. **Hardcoding query limits**: All query limits must come from `QUERY_LIMITS` in `lib/config/limits.ts`. This allows env-var overrides without code changes.
2. **Silent data truncation**: Every page that displays limited query results must include a `LimitBanner` component. If the user sees 500 items and there are 501, they must know.
3. **Using `.select("id")` on tables with composite PKs**: `jury_assignments` has no `id` column. Use `.select("user_id")` or the actual PK columns.
2. **Forgetting `revalidatePath()` after mutations**: If a server action modifies data, revalidate the relevant paths so the UI updates.
3. **Silent error swallowing**: Never use `.catch(() => {})`. At minimum, log the error: `.catch((err) => console.error("context:", err))`.
4. **Hardcoding secrets**: Never hardcode emails, keys, or credentials. Use environment variables. Admin fallback emails come from `ADMIN_FALLBACK_EMAILS` env var.
5. **Adding `force-dynamic` unnecessarily**: Only use `export const dynamic = "force-dynamic"` when the page genuinely needs fresh data on every request (e.g., forms with CSRF tokens, real-time status).

## Service Plan Limits (as of 2026-04-27)

External service limits that affect the platform. If you hit unexplained errors (timeouts, 429s, storage full), check these first.

### Vercel (Pro, $20/mo)
- Function timeout: 60s (was 10s on Hobby)
- Bandwidth: 1TB/mo
- Serverless function executions: unlimited
- Deployments: unlimited

### Supabase (Free tier)
- Database: 500MB storage
- Auth: 50,000 monthly active users
- Storage: 1GB file storage
- API requests: unlimited but 500 concurrent connections
- Realtime: 200 concurrent connections
- Edge functions: 500,000 invocations/mo
- **Watch out**: Database approaching 500MB triggers warnings. Consider Pro ($25/mo) if approaching limit.

### Upstash Redis (Free tier via Vercel Marketplace)
- Commands: 10,000/day
- Storage: 256MB
- **Watch out**: Rate limiting uses ~1 command per check. At 500 users, login/register/apply flows can use ~2000-5000 commands/day. If rate limiting stops working silently, check if the daily command limit was hit.

### Cloudflare (Free tier)
- Turnstile: 1M siteverify calls/mo (effectively unlimited for our scale)
- No bandwidth limits on siteverify API

### Google Cloud
- OAuth consent screen: 100 users in testing mode, unlimited in production
- Gmail API (for Google Drive): 250 quota units/second

### OpenRouter (pay-per-use)
- No rate limit but cost scales with usage
- Code review pipeline: ~$0.10-0.30 per review (depends on repo size + models)
- Budget for 100 reviews/chapter: ~$10-30

### GitHub
- API rate limit: 5,000 requests/hour (authenticated)
- Actions: 2,000 minutes/mo (free for public repos)
- Snapshot fork repos count toward org limits
