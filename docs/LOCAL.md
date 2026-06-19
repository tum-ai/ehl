# Running EHL Locally

How to run the EHL platform on your machine: against the **test Supabase** DB, with the **Turnstile CAPTCHA** and **admin Google OAuth** friction handled.

> This file is committed to a **public repo**. It contains placeholders only. Never paste real keys, passwords, or project refs here. Get real values from `.env.local` / `.env.test` (gitignored, in the ops repo).

## TL;DR

| Goal | Command | CAPTCHA | Admin auth |
|------|---------|---------|------------|
| Everyday dev | `pnpm dev` (port 3000) | auto-skipped (`NODE_ENV=development`) | Google OAuth, authorized via `ADMIN_FALLBACK_EMAILS` |
| E2E lifecycle vs test DB | `pnpm test:e2e:lifecycle` (port 3001) | Turnstile **test keys** (`1x0000…`) auto-pass | magic-link shortcut, no real OAuth |
| Prod-fidelity sim + mailpit | `pnpm test:sim` (port 3001) | test keys / `TURNSTILE_OPTIONAL=true` | `ADMIN_FALLBACK_EMAILS` |

---

## 1. Prerequisites

```bash
pnpm install
# For DB migrations and the live simulation:
brew install libpq && brew link --force libpq   # psql, for setup-test-db
brew install mailpit                             # local SMTP sink, for the sim
```

You also need the gitignored env files from the ops repo:
- `.env.local` — your dev credentials
- `.env.test` — the **test** Supabase instance (must contain `SUPABASE_TEST_MODE=true`)

---

## 2. Everyday development (`pnpm dev`)

```bash
pnpm dev          # http://localhost:3000
```

`NODE_ENV` is `development`, which changes two behaviors:

### Turnstile / bot protection is bypassed automatically

`lib/turnstile.ts` short-circuits before ever calling Cloudflare:

```ts
export async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  // Skip in development
  if (process.env.NODE_ENV === "development") return true;
  // Emergency prod bypass: TURNSTILE_OPTIONAL=true
  ...
}
```

So in dev you do **not** need real Turnstile keys: server verification always returns `true`. On the client, `components/ui/turnstile.tsx` also detects Cloudflare test site keys (those starting with `1x0000000000000000000`) and skips rendering the widget, returning a `"test-token"` instead of loading the Cloudflare script. Any placeholder in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` is fine.

### Admin login via Google OAuth

The OAuth handshake is **real** even locally (Supabase performs it), there is no fake-login. What makes it work locally is the **authorization** layer in `lib/admin-allowlist.ts`:

```ts
export async function isAdminEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  if (!normalized.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) return false;   // (1) domain
  try {
    // (2) admin_emails table lookup
    ...
  } catch {
    // (3) DB unreachable -> ADMIN_FALLBACK_EMAILS env list
    const fallback = process.env.ADMIN_FALLBACK_EMAILS;
    ...
  }
}
```

To log in as admin on localhost:

1. In `.env.local` set:
   ```
   ADMIN_EMAIL_DOMAIN=your-org-domain.com
   ADMIN_FALLBACK_EMAILS=you@your-org-domain.com
   ```
   (Email must end in `ADMIN_EMAIL_DOMAIN` **and** be in the `admin_emails` table or the fallback list.)
2. Make sure your Supabase project's Google provider lists `http://localhost:3000/auth/callback` as an allowed redirect URI, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
3. Go to `/admin/login`, click **Sign in with Google**, use a Google account whose email is in the allowlist.

> The **test** Supabase has Google OAuth disabled. To exercise admin OAuth interactively, point `.env.local` at a Supabase project where Google is configured (production config or your own). E2E tests do not use OAuth at all (see below).

Participant login (`/login`, `/register`) is email + password and needs no special handling. Jury login (`/jury/login`) is an email magic link.

---

## 3. Running against the test Supabase DB

The test DB (`SUPABASE_TEST_MODE=true` in `.env.test`) is a separate Supabase project. Every script guards on that flag and refuses to run without it, so you can't accidentally hit production.

### One-time / after schema changes: sync the test DB

```bash
pnpm test:setup-db        # applies all 44 migrations + seed to the test DB via psql
# full automated project bootstrap (needs SUPABASE_ACCESS_TOKEN):
# pnpm test:setup-supabase
```

`scripts/setup-test-db.ts` connects with `SUPABASE_DB_PASSWORD` from `.env.test`, applies every file in `supabase/migrations/` in order, loads `supabase/seed.sql`, and reloads the PostgREST schema cache.

### Run the E2E suite

Playwright loads `.env.test` and (locally) boots a dev server on **port 3001** so it never collides with your `pnpm dev` on 3000:

```bash
pnpm test:e2e:lifecycle   # full hackathon lifecycle flow (Chromium)
pnpm test:e2e             # setup + lifecycle + cross-browser smoke + cleanup
pnpm test:e2e:ui          # Playwright UI mode
```

In E2E, Turnstile uses the Cloudflare **test keys** (`1x0000…`) so the widget auto-passes, and admin auth uses a **magic-link shortcut** (the test admin profile already has `role=admin`, so the callback routes it to `/admin` without going through Google). This is why no OAuth automation is needed.

---

## 4. Prod-fidelity local stack (the simulation harness)

`pnpm test:sim` runs `scripts/sim-run.sh`, which is the closest thing to "production on localhost":

1. Migrates the test DB to repo schema.
2. Starts **Mailpit** (SMTP sink on `:1025`, web UI on `:8025`) so emails are captured, never sent.
3. Builds and starts a **production** build (`pnpm build && pnpm start`) on **port 3001**, using `.env.e2e-live`.
4. Runs the full-UI Playwright simulation across Chromium/Firefox/WebKit.
5. Tears everything down.

```bash
pnpm test:sim                 # full run (migrate + build + sim)
pnpm test:sim -- --no-build   # reuse the existing .next build
pnpm test:sim -- --keep-up    # leave app (:3001) + Mailpit (:8025) running to poke at
```

`.env.e2e-live` derives from `.env.test` with the SMTP host/port pointed at Mailpit (`localhost:1025`) and an `ADMIN_FALLBACK_EMAILS` entry for the test admin. It also requires `SUPABASE_TEST_MODE=true` — the script aborts otherwise.

> Why a local prod build instead of a Vercel preview? Staging previews are SSO-locked with no bypass, and other previews run against **production** env. The local prod build + `.env.test` is the only way to exercise production behavior (real Turnstile path, real build output) without touching prod data.

---

## 5. Quick troubleshooting

| Symptom | Cause / fix |
|---|---|
| CAPTCHA blocks a form locally | You're on a prod build, not `pnpm dev`. Use test keys (`1x0000…`) or set `TURNSTILE_OPTIONAL=true`. |
| `/admin/login` says "not authorized" | Email not in `admin_emails` and not in `ADMIN_FALLBACK_EMAILS`, or it doesn't end in `ADMIN_EMAIL_DOMAIN`. |
| Google OAuth redirect fails locally | Add `http://localhost:3000/auth/callback` to the Supabase Google provider; set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`. |
| `setup-test-db` aborts immediately | `.env.test` missing `SUPABASE_TEST_MODE=true` (prod-safety guard). |
| Port 3001 already in use | A previous E2E/sim server is still up: `lsof -ti:3001 \| xargs kill`. |
| `psql: command not found` | `brew install libpq && brew link --force libpq`. |
| `mailpit: command not found` | `brew install mailpit`. |

See [docs/TESTING.md](TESTING.md) for the full E2E architecture and [docs/SETUP.md](SETUP.md) for from-scratch deployment.
