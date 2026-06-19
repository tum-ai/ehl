# Hackathon simulation (local, shared DB)

Spin up the EHL app locally to **manually simulate a hackathon** — admins advance
chapters, participants submit, jurors score. Everyone runs the app on their own
`http://localhost:3001`, but **all instances share one database**, so the world stays
consistent across testers. Login is a one-click persona picker (no Google).

- **Shared database:** the hosted **test** Supabase (creds live in `ehl-ops/.env.test`).
- **Run method:** Docker — testers need **only Docker**, no Node/pnpm.
- **Login:** `http://localhost:3001/dev-login` → click a persona.

---

## One-time setup (operator, once per shared DB)

Seeds the shared test DB with the fixed personas (`auth.users`) and the full scenario
(3 chapters, 6 teams, jury, submissions, scores). Re-run any time to reset to a clean
world.

```bash
cd ehl
cp ehl-ops/.env.test .             # NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
cp ehl-ops/.env.supabase .         # SUPABASE_ACCESS_TOKEN + SUPABASE_TEST_REF
pnpm install
pnpm exec dotenv -e .env.test -e .env.supabase -- tsx scripts/seed-test-via-api.ts
```

Success prints e.g. `Chapters now in test DB: munich-1, zurich-2, berlin-3`.

> The seed creates the personas below as confirmed `auth.users`, so magic-link / dev
> login works for all of them. Testers never run this.

---

## Per-tester setup

Needs **Docker only** — no Node or pnpm required.

1. Get `.env.sim` (real shared test-DB values). Either copy it from the team, or:
   ```bash
   cd ehl
   cp .env.sim.example .env.sim
   # paste the test-DB values from ehl-ops/.env.test into .env.sim:
   #   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
   ```
   `.env.sim` is gitignored — never commit it (this repo is public).

2. Build and start:
   ```bash
   docker compose --env-file .env.sim up --build
   ```

3. Open **http://localhost:3001/dev-login** and click a persona.

The first build takes ~5–10 minutes (deps + Next.js compile inside the container). Subsequent
starts without code changes are instant. `NEXT_PUBLIC_*` values are passed as Docker build
args so they get baked into the browser bundle; server-side vars are injected at runtime via
`env_file`. The heap is capped at 2 GiB inside Docker to prevent OOM on low-memory VMs.

---

## Personas

Defined in `lib/dev-login.ts` (`DEV_PERSONAS`), matching `supabase/seed.sql`.

| Persona | Email | Role | Lands on |
|---|---|---|---|
| Admin | `admin@example.com` | admin | `/admin` |
| Jury 1 | `jury1@example.com` | jury | `/jury` |
| Jury 2 | `jury2@example.com` | jury | `/jury` |
| Alice (Alpha Innovators) | `alice@example.com` | participant | `/dashboard` |
| Bob (Alpha Innovators) | `bob@example.com` | participant | `/dashboard` |
| David (Beta Hackers) | `david@example.com` | participant | `/dashboard` |

Sessions are per-browser, so several people can each be a different persona at the same
time (or use separate browser profiles on one machine).

---

## Simulating a hackathon

1. **Admin** advances a chapter (e.g. Zurich) through the status flow:
   `challenge_selection → submissions_open → pitching → completed`.
2. **Participants** open their dashboard and create/edit submissions while
   `submissions_open`.
3. **Admin** assigns jury to challenges; **Jury** reviews and ranks submissions.
4. **Admin** publishes scores; the public leaderboard updates.

Everyone sees the same state because they share one DB.

---

## Reset

An operator re-runs the seed command above. Testers just reload.

## How the no-Google login works

`/dev-login` (gated by `DEV_LOGIN_ENABLED=true`) calls `devLoginAction`
(`lib/actions/dev-login.ts`), which mints a single-use Supabase magic-link token via the
service role and consumes it **server-side** with `verifyOtp` in the same request. The
session cookie is written directly onto the action's response, then it redirects to the
persona's destination. It deliberately does **not** bounce the token through the URL /
`app/auth/callback/route.ts`: magic-link tokens are single-use, so a prefetch or retried
click would consume the token and drop the user on the login page. Verifying server-side
consumes it exactly once. (`scripts/dev-admin-login.js` is the older single-persona CLI
variant; `/dev-login` is one click and covers every role.)

The page and action both **404 / refuse** unless `DEV_LOGIN_ENABLED === "true"`, and a
runtime tripwire additionally throws if the flag is ever set on the production deployment
(`VERCEL_ENV === "production"`), so it cannot be enabled there even by mistake. The check
keys off `VERCEL_ENV`, not `NODE_ENV`, because the Docker sim image intentionally runs with
`NODE_ENV=production`.
