# Live-UI hackathon simulation

A Playwright suite that drives the **real** EHL UI end to end against a running
production build (port 3001) backed by the **test** Supabase, with SMTP captured
by Mailpit (HTTP :8025, SMTP :1025). Every action a human takes is performed
through real forms, buttons, and navigation. Email steps (verification codes,
magic links, invites, confirmations) are read from Mailpit — never from the DB.

The Supabase admin client is used only for:
- assertions (confirming persisted DB state), and
- bootstrapping preconditions that have **no working participant/admin UI**
  (documented per slice below).

## Running

```bash
# Prereqs (already running in this environment — do NOT start/stop them):
#   - prod build of the app on http://localhost:3001 (test Supabase)
#   - Mailpit on http://localhost:8025

# All slices, in order:
node_modules/.bin/dotenv -e .env.e2e-live -- \
  npx playwright test --config=playwright.sim.config.ts

# One slice:
node_modules/.bin/dotenv -e .env.e2e-live -- \
  npx playwright test --config=playwright.sim.config.ts e2e/simulation/04-teams.sim.ts

# One test within a slice:
... --grep "invites a member"
```

`workers: 1`, headless by default. HTML report in `playwright-report-sim/`.

## Slices

| # | File | Covers (all through the real UI unless noted) |
|---|------|-----------------------------------------------|
| 01 | `01-registration.sim.ts` | Solo participant registration: mode picker → details → verification code from Mailpit → verify → authenticated; then re-login via `/login`. |
| 02 | `02-application.sim.ts` | Admin opens applications (status control); an anonymous applicant fills the real `/apply/<slug>` form and uploads a PDF CV; confirmation email captured in Mailpit. Also asserts a non-PDF CV is rejected by the UI. |
| 03 | `03-screening.sim.ts` | Two applicants apply; admin accepts one / rejects one via the real screening table buttons; admin advances the chapter to `preparation` via the real status control. |
| 04 | `04-teams.sim.ts` | President creates a team on the dashboard; invites a member by email → invite email in Mailpit → invitee accepts on the real `/invite/<token>` page. A "looking for team" user requests to join via the dashboard and the president approves via the real Join Requests UI. |
| 05 | `05-challenge-and-submission.sim.ts` | Admin creates a chapter + challenge (real admin UI) and walks the status flow; a checked-in team registers for the challenge on the real event hub, then submits a project on the real submission form. |
| 06 | `06-jury.sim.ts` | Admin assigns a jury member to a challenge via the real admin jury UI (emails a magic link); the jury logs in via the real `/jury/login` (magic link from Mailpit) and submits a ranking on the real ranking UI. |
| 07 | `07-scoring-leaderboard.sim.ts` | Admin finalizes jury voting (real admin jury UI → generates scores) and publishes results on the real admin scores page; the public `/leaderboard` and `/matches` pages reflect the result. |
| 08 | `08-media.sim.ts` | Admin uploads a photo (generated PNG) via the real admin media UI; a `media` row is persisted. |

## Shared helpers (`sim-helpers.ts`)

- **Auth**: `registerSoloViaUI`, `loginViaUI`, `juryLoginViaUI`,
  `adminLoginViaSession` (only the admin login *handshake* is shortcut via a
  magic-link callback — Google OAuth is disabled on the test Supabase; every
  admin **action** is then done through the real admin UI).
- **Email**: re-exports `waitForEmail` / `extractVerificationCode` /
  `extractLink` from `../helpers/mailpit`.
- **Chapters/challenges (real admin UI)**: `createChapterViaUI`,
  `createChallengeViaUI`, `advanceChapterStatusViaUI`, `assignJuryViaUI`.
- **Applicant/jury flows (real UI)**: `submitApplicationViaUI`,
  `submitSingleTeamRankingViaUI`.
- **Fixtures**: `tinyPdfBuffer`, `tinyPngBuffer` (generated in-memory, no files
  on disk).
- **Bootstrapping (no clean UI exists)**: `createDraftChapterRow`,
  `bootstrapCheckedInTeam`, `bootstrapSubmission` (see "Gaps" below).
- **Cleanup**: `cleanupSimData` (run in every slice's `beforeAll`).

### Run isolation

Simulated people use `@sim-ehl.com` emails. `simEmail("x")` appends a per-run
token (`SIM_RUN`, stable within one `playwright test` invocation, unique across
runs). This is required because any participant who performs a logged action
writes an immutable `event_log` row (append-only trigger) that holds a foreign
key to their profile, so such profiles can never be hard-deleted. Fresh
per-run emails keep leftover event-logged profiles harmless;
`cleanupSimData()` removes everything else it can (chapters/teams/challenges
named `Sim %`, applications/verification codes/team data by sim email, and
profiles/auth users without blocking FKs).

## Gaps — steps NOT done purely through the UI (and why)

1. **Chapter creation row.** The real "New Chapter" admin button is broken on a
   correctly-migrated schema (see `FINDINGS.md` #1), so the initial *draft*
   chapter row is inserted via the admin client; all chapter detail editing and
   status advancement is then done through the real UI.
2. **Participant check-in** (slice 05). Check-in has no participant-facing UI
   (it is admin QR/name-search of an *accepted* application + a check_in_token).
   The accepted+`checked_in` application rows are bootstrapped via the admin
   client; the challenge registration and submission that depend on them are
   done through the real UI.
3. **Submission used by the jury/scoring slices** (06, 07). The submission +
   challenge registration are bootstrapped via the admin client because their
   own UI is already covered end to end by slice 05; these slices' subjects are
   the jury and scoring UIs.

## Real app bugs found

See `FINDINGS.md`. Summary: `createNewChapter()` omits the NOT NULL
`match_number`, so the admin "New Chapter" button fails on a correctly-migrated
database.
