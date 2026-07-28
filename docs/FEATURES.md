# EHL Platform: Feature Guide

Complete list of every feature the platform provides. Organized by user role.

---

## Table of Contents

1. [Public Website](#1-public-website)
2. [Participant Features](#2-participant-features)
3. [Event Day Features](#3-event-day-features)
4. [Jury System](#4-jury-system)
5. [AI Code Reviews](#5-ai-code-reviews)
6. [Admin Panel](#6-admin-panel)
7. [Automated Systems](#7-automated-systems)

---

## 1. Public Website

Accessible to everyone without login.

### Landing Page (`/`)
- Animated hero with map of Europe and city markers (dynamic from DB, animation includes all configured cities)
- Dynamic "Apply Now" CTA when a chapter has open applications (falls back to "View Leaderboard")
- "How it Works" explainer section
- Tour timeline showing all season matches
- Live leaderboard preview (top 3 podium)
- Media section with embedded YouTube videos
- Partner bar with logos
- "Founded by TUM.ai" attribution

### Match Pages (`/matches`, `/matches/<slug>`)
- Overview of all matches with status badges
- Detail pages adapt to match status:
  - **Announced**: Date, location, description
  - **Applications Open**: Apply button, deadline countdown
  - **Hacking/Submissions**: Challenge list, sponsor info
  - **Pitching**: Pitch order display
  - **Completed**: Results with placements, scores, photos

### Leaderboard (`/leaderboard`)
- Season standings with podium for top 3
- Sortable table with rank, team, points, matches played, best finish
- Scoring rules explainer (how points are awarded)

### Team Profiles (`/team/<slug>`)
- Public team page showing members, university, origin
- Season scores per match

### Rules (`/rules`)
- Season structure (dynamic match/city counts from DB)
- Scoring system explanation
- Team formation rules

### Partners (`/partners`)
- Per-match partner showcase
- Three tiers: Challenge Partner, Tech Partner, Community Partner
- Logos pulled from Supabase Storage

---

## 2. Participant Features

Requires participant account (email + password).

### Registration (`/register`)
- **Solo registration**: Enter name, email, password, university. Receive verification code by email, confirm to create account.
- **Team registration**: Register a team with up to 5 members. Team president creates the team, members receive invite emails.
- Encrypted verification codes (AES-256-GCM) for secure email confirmation
- Turnstile CAPTCHA on all forms

### Login (`/login`)
- Email + password authentication
- Password reset via email link (`/forgot-password`)

### Dashboard (`/dashboard`)
- **Team stats**: Rank, total points, member count
- **Team management** (president only):
  - Invite members by email
  - Accept/decline join requests
  - Browse "looking for team" users and invite them
  - Toggle "looking for members" status
- **Member roster** (read-only for non-presidents)
- **Match list**: All non-draft matches with status badges
  - "Unlocked" badge when team has access
  - Personal certificate links for completed matches with published scores:
    achievement plus neutral participation for placed members, participation
    only for unplaced members
- Link to public team profile

### Applications (`/apply/<chapter-slug>`)
- Per-chapter application form
- Fields: motivation, skills, experience, dietary restrictions
- CV upload (PDF, stored in Google Drive)
- Team member listing (auto-populated from team)
- Consent checkboxes
- Application status tracking (pending, accepted, rejected, waitlisted)

### Certificates
- PDF certificates generated on-demand at `/api/certificates/<chapterId>/<teamId>`
- Requires authentication: team members and admins via session, or a capability
  token from the certificate email (each token unlocks exactly one certificate)
- A4 landscape, white background, printable
- **Two variants**:
  - *Achievement* (teams placed 1st-5th): gold badge with placement and points
  - *Participation*: neutral purple badge, never shows points or placement
- **Personal certificates**: every certificate link offered in emails and on
  the dashboard carries the participant's own name, with their team shown on
  the Team line. Select via `?member=<userId>`.
- **Placed members get both**: in addition to their achievement certificate,
  they can download a personal neutral participation certificate
  (`?variant=participation&member=<userId>`), e.g. to share without revealing
  their ranking
- Shows: participant, team, university, match, challenge, location, date
- EHL branding with purple corner brackets, or a per-chapter custom background
  design uploaded by an admin (see Admin > Certificate Designs)
- Personal download links appear on the dashboard for completed matches and in
  each member's certificate email

---

## 3. Event Day Features

Available to participants who are checked in at an event.

### Event Hub (`/event/<slug>`)
- Central page for everything happening during the hackathon
- Shows current match status, deadlines, challenge info
- **Event info panel**: an admin-maintained note (Discord link, schedule, venue) shown at
  the top of the hub. Visible to accepted participants even before they are checked in
  (the rest of the hub is gated on check-in). Edited under admin Communications.

### Check-in (Admin side)
- Admin scans participant QR code at `/admin/check-in`
- QR code is embedded in the acceptance email
- Marks participant as checked in

### Walk-In Registration (`/walk-in/<token>`)
- Fills no-show spots at the event: a walk-in scans a per-chapter walk-in QR, fills the
  normal application form on their phone AND creates an EHL account in one step, and
  becomes an auto-accepted full league participant (application status `accepted`).
- Admin/chapter-admin side: `/admin/chapters/<id>/walk-in` shows a large printable QR and
  copyable link, plus a "Rotate token" action that invalidates previously printed QRs.
- The walk-in token is an unguessable per-chapter UUID stored in the admin-only
  `chapter_walk_in` table (never on the public `chapters` row). The walk-in page resolves
  the chapter from the token via a service-role server action; a rotated/invalid token 404s.
- The token (not the chapter status) gates the form, so walk-ins work during hacking /
  submissions_open. Only `draft`/`completed` chapters are refused.
- If the email already has an account, registration is refused ("sign in first, then use
  the walk-in link") — no second account is created and the existing password is untouched.
- After registering, the walk-in sees their personal check-in QR and is checked in via the
  existing `/admin/check-in` flow (unchanged). They form or join a team later in the event hub.
- Roles: anyone with the link can register a walk-in; the admin page is available to global
  and chapter admins of that chapter.

### Partner Showcase (`/showcase/<token>`)
- A read-only, token-gated page an admin shares with a match's sponsors. It shows, for that
  chapter: the applicants who consented to sponsor sharing (name, LinkedIn, GitHub), a badge
  marking who actually participated (checked in), the teams and final published ranking, and
  the event photo gallery. When enabled, each applicant's CV can be viewed/downloaded.
- Consent is the hard gate: an applicant appears ONLY if they opted into sharing their
  profile with recruiters/sponsors (`consent_sponsor_data` OR `consent_recruiting`, the OR
  covering pre-migration-00034 opt-ins). Application status is not a gate: all statuses are
  shown, with `checked_in` applicants badged "Participated"; internal decisions like
  "rejected" are collapsed to the neutral "Applied" label so a sponsor never sees them.
- Photos are ONE per-chapter pool (shown in the showcase gallery and on the public chapter
  page once completed) and are managed in ONE place: the Photos page
  (`/admin/chapters/<id>/photos`, linked from the chapter Manage card). The showcase admin
  page shows the current photo count and links there (global admins).
- Photo download (showcase gallery): a "Download all" button, and a "Select" mode with a
  checkbox per photo plus "Select all" / "Download selected". Both produce ZIP(s) of the
  full-resolution Drive originals via `POST /api/showcase/<token>/photos`. The route never
  trusts the client's selection: it intersects the requested fileIds with the chapter's real
  photos (so a smuggled Drive id, e.g. a CV, is dropped, never fetched), and it is gated by
  the live token + a dedicated per-IP photo-ZIP rate limiter (12/10min, separate from the
  stricter 3/10min CV limiter so a legitimate multi-batch "download all" is not throttled).
  Albums larger than one batch are downloaded as several sequential ZIPs client-side
  (`ehl-photos-1.zip`, `-2.zip`, ...) so no single request risks the function timeout; if a
  batch fails mid-run the user is told how many ZIPs they already got. A single request over
  the per-ZIP cap (`LIMIT_SHOWCASE_PHOTO_ZIP`, default 150) is refused loudly (413), never
  silently truncated.
- Admin/chapter-admin side: `/admin/chapters/<id>/showcase` shows the copyable link, a
  "Rotate link" action, an enable toggle (off by default: an unshared showcase 404s), a
  "Show CVs" toggle (off by default), an optional expiry date, and live counters (visible /
  hidden-due-to-consent / participants / CVs available) so the operator sees exactly what a
  sponsor will see before sharing.
- The showcase token is an unguessable per-chapter UUID stored in the admin-only
  `chapter_partner_showcase` table (never on the public `chapters` row). The public page
  resolves the chapter from the token via a service-role server action; a
  rotated/invalid/disabled/expired token 404s.
- Each applicant card shows the team the person actually played on at this event
  (resolved from the chapter's challenge registrations, not their current global team);
  the search box also matches team names.
- "Download all CVs" downloads every consented, visible CV (same consent gate as the list;
  failed fetches listed in a manifest instead of a corrupt archive). Because a full-res CV
  is ~2s to fetch from Drive and a chapter can have hundreds, a single ZIP of everything
  would exceed the 300s function timeout (a real 159-CV chapter hit this and a partner saw
  no working download). The route serves a batch window (`GET ...?offset=&limit=`, applied
  AFTER the consent gate so no offset can reach a non-consented CV, each window capped at
  `LIMIT_SHOWCASE_CV_ZIP`); the client requests the batches sequentially, one ZIP each
  (`ehl-cvs.zip`, `ehl-cvs-2.zip`, ...), so the download works at any chapter size. A
  dedicated per-IP CV-ZIP limiter (12/10min) covers the largest chapter plus retries.
- CVs are served through a token-gated proxy (`/api/showcase/<token>/cv/<applicationId>`)
  keyed by application id (Drive file ids stay server-side). It re-checks the token, the
  `show_cvs` toggle, chapter ownership, and consent before streaming, with `no-store` +
  `noindex` + `no-referrer` headers and per-IP rate limiting.
- Roles: anyone with the link can view the showcase; the admin page is available to global
  and chapter admins of that chapter.

### Challenge Selection
- After check-in, teams browse available challenges
- Each challenge shows: sponsor, description, prize, judging criteria, brief PDF
- Team registers for exactly one challenge per match
- A team must have 2 to 5 members to register for a challenge (single-person teams cannot select a challenge); enforced server-side and reflected in the UI
- All team members must be checked in before the team can register
- Challenge registration can be opened/closed by admin via deadline

### Team Formation (Event Day)
- Create a new team on the spot
- Search for other participants looking for teammates
- Send/receive join requests
- "Looking for team" toggle on profile

### Submissions (`/event/<slug>` submission section)
- Upload project files (stored in Google Drive, organized by Chapter/Team)
- Link GitHub repository (automatically forked for jury review)
- Add tech stack tags
- Submission deadline countdown timer
- Submissions lock automatically when deadline passes (via cron or admin action)

### Pitch Order
- Admin generates randomized pitch order per challenge
- Displayed to teams and jury in the event hub

---

## 4. Jury System

Jury members use magic link authentication (no password).

### Login (`/jury/login`)
- Enter email, receive magic link
- One-click login from email

### Submission Review (`/jury/<chapter-slug>`)
- List of all submissions assigned to this jury member
- Full detail view per submission:
  - All submitted fields (description, tech stack, links)
  - GitHub repo link (forked to snapshot org for permanence)
  - AI code review report (if available)
  - Any uploaded files

### Ranking (`/jury/<chapter-slug>/rank`)
- Drag-and-drop interface to rank teams
- Rankings are per-challenge (jury member ranks all teams in their assigned challenge)
- Submit ranking (INSERT-only, cannot be changed after submission)
- Option to skip voting on a challenge

### Feedback
- Per-team feedback notes visible to admins
- Helps admins understand jury reasoning

### How Jury Voting Works
1. Admin invites jury members (sends magic link email)
2. Admin assigns jury to specific challenges
3. Jury reviews submissions and AI code review reports
4. Jury ranks teams via drag-and-drop
5. Rankings are aggregated (Borda count style)
6. Admin reviews aggregated results and can override
7. Admin publishes final scores

---

## 5. AI Code Reviews

Automated code quality assessment using multiple LLM agents.

### Pipeline Stages
1. **Tech Description Agent**: Summarizes what the project does and its tech stack
2. **Code Quality Agent**: Evaluates code structure, readability, best practices
3. **Highlights Agent**: Identifies impressive techniques and potential issues
4. **Originality Agent**: Assesses creative approaches and novel solutions
5. **Session History Agent** (when Entire is required): Scores development-process quality from the captured AI coding session (see Entire Session History below). Advisory bonus only.
6. **Coordinator Agent**: Synthesizes all reports into a final score with weighted categories

### Configuration (per challenge)
- Enable/disable code review
- Require Entire session history (see below)
- Choose LLM models (via OpenRouter)
- Set scoring weights per category
- Add custom review instructions
- Set token budget

### Entire Session History (per challenge, optional)
[Entire](https://entire.io) is a client-side CLI that captures AI coding-agent sessions on an orphan git branch (`entire/checkpoints/v1`). When a challenge has "Require Entire Session History" enabled:

- **Hard gate (at submission):** the repo must contain the `entire/checkpoints/v1` branch with at least one captured prompt. If missing, submission is blocked with a clear, actionable error. The presence check is intentionally soft: it tolerates imperfect checkpoints across different agents (Claude Code, Codex, Cursor, Gemini, ...) and Entire versions, accepting any positive signal (prompt file, session metadata, or transcript).
- **Capture:** the checkpoint branch is copied into the private EHL fork (not the public path), so transcripts stay under EHL control.
- **Advisory bonus:** a session-history agent scores process quality (ownership language, technical specificity, iteration/verification, edge-case awareness) plus completeness/tamper-plausibility (including whether checkpoint commits are signed). This is highlighted in the jury report. It is informational only and never feeds the placement/leaderboard score.
- **Off switch:** the whole behavior is per-challenge, like code review. Roles affected: participants (must enable Entire to submit), jury (see the bonus), admins (toggle it).

### Execution
- Triggered manually by admin or automatically after submission deadline
- Queueing only WRITES `status=queued` rows. The actual pipeline runs in GitHub Actions (avoids the Vercel function timeout), triggered by a `repository_dispatch` event of type `process-code-reviews` (requires `GITHUB_TOKEN` + `GITHUB_REPO` on the app, and the `process-code-reviews` workflow with `GH_PAT` + Supabase + OpenRouter secrets).
- **Dispatch visibility:** the queue endpoint no longer swallows dispatch errors. It checks the GitHub response and returns a structured result; the admin page shows a green "Worker triggered" banner on success, or an amber banner naming the misconfiguration (e.g. missing `GITHUB_TOKEN`/`GITHUB_REPO`, HTTP 404 wrong repo / bad token) on failure, so a stuck "Queued" state is never silent. The same surfacing applies to the deadline cron's auto-dispatch (logged in its transitions).
- **Throughput (parallel workers):** the worker workflow fans out a single dispatch into a matrix of parallel jobs. Each worker atomically claims queued rows (`UPDATE ... WHERE status='queued'`) and loops until the queue drains, so workers self-balance and never double-process. This is what lets ~100 repos finish within the event window; a single serial worker could not. Raise the matrix size in `.github/workflows/process-code-reviews.yml` to add throughput.
- Queue depth limited to 200 concurrent reviews (configurable via `LIMIT_CODE_REVIEW_QUEUE_DEPTH`)

### Live Status Overview (admin)
The admin code-reviews page (`/admin/chapters/<id>/code-reviews`) shows a live view of pipeline progress:
- **Summary counts by status:** pending / queued / processing / completed / failed, plus total cost, aggregated across the chapter's submissions.
- **Per submission:** current status badge, the pipeline `progress` string (e.g. "Running coordinator..."), cost, and the failure error message when failed.
- **Auto-refresh:** while any review is queued or processing, the page polls a single lightweight chapter-scoped endpoint (`/api/admin/chapters/<id>/code-reviews`, chapter-admin scoped) every few seconds and STOPS once nothing is in flight. Truncation beyond the query limit shows a `LimitBanner`.

### Report Cards
- Visual score display per submission
- Weighted total score
- Highlights, concerns, "would it run" verdict
- Visible to jury members for informed decision-making

---

## 6. Admin Panel

Accessible at `/admin`. Light theme. Requires Google OAuth with email on allowlist.

There are two kinds of admin:
- **Global admins** — email on the `admin_emails` allowlist. Full access to every
  chapter and all global tooling.
- **Local (chapter) admins** — invited per-chapter by a global admin. Scoped to a
  single chapter; see the section below.

### Local Admins (`/admin/chapters/<id>/admins`)
- A global admin invites a person by name + email on a chapter's "Local Admins" page.
  Any email domain works, including external partners (e.g. `@iterate.com`) — no
  change to `ADMIN_EMAIL_DOMAIN` is needed.
- The invitee logs in at `/admin/login` with Google OAuth (the account is
  pre-provisioned at invite time so the first login works) and lands directly on
  their chapter.
- A local admin sees a reduced sidebar (Chapter, Screening, Teams, Check-in) and is
  confined to that one chapter: application screening, the chapter's teams &
  participants, submissions, and check-in.
- They **can**: score applications (screening), view the CVs of applicants in their
  own chapter, and check participants in.
- They **cannot**: see other chapters or any global admin view, edit chapter
  settings, change status, manage challenges/jury/partners, publish scores, or delete
  anything. Inviting/removing local admins is a global-admin action.

### Chapter Management (`/admin/chapters`)
- Create new chapters (matches)
- Edit name, city, country, description, dates, deadlines
- Upload hero image
- Status progression: draft > announced > applications_open > screening > registration_open > submissions_open > pitching > completed
- Readiness checks prevent premature status advances (e.g. "at least one challenge exists")
- Photo album management
- Delete a chapter (global admins only): a type-to-confirm "Danger zone" that removes the chapter and cascades all its children (challenges, submissions, applications, scores, jury data, partners, media); audit-logged

### Application Screening (`/admin/chapters/<id>/applications`)
- View all applications with filters
- Screener scoring per application
- Bulk accept/reject/waitlist
- Send branded acceptance/rejection emails
- View CVs (proxied from Google Drive via the service account; chapter-scoped, so a
  local admin sees only CVs of applicants in their own chapter)
- Cross-chapter screening signals per applicant: prior screening scores from other
  chapters, past participations (checked in elsewhere), and a No-Show warning (checked
  in at a previous event but their team submitted nothing). No-shows are only counted
  for chapters where check-in actually ran: events that predate the check-in feature
  (e.g. the first hackathon) never produce No-Show flags, since attendance there was
  never recorded.
- Cancel an accepted applicant (e.g. they can no longer attend): keeps the record
  with a visible "cancelled" status, requires a reason, and can optionally send a
  branded cancellation email. Allowed even after the acceptance email was sent.
  Cancellation is terminal: there is no reversal back to accepted (once the
  acceptance email is out, the person has already been told they are out). Global
  and chapter admins. Cancelling also removes the person from any challenge
  registration rosters in that chapter, so a cancelled attendee no longer counts
  toward their team.
- Admin notes history per application (append-only): the cancellation is recorded
  and admins can add free-text notes. Transitions are also written to the
  immutable `event_log`.

### Communications (`/admin/chapters/<id>/communications`)
Global and chapter admins. Three tools for talking to a chapter's participants:
- **Customizable acceptance email**: an editable subject line and an optional custom
  message block per chapter. The fixed parts (QR code, check-in instructions, match
  details, button) are always included, so check-in is never affected. When left blank,
  the email is identical to the default (`You're in! Accepted for <match>`).
- **Broadcast email**: compose a one-off branded email to the chapter's applicants and
  pick the recipient statuses per send (accepted, checked-in, waitlisted; defaulting to
  accepted + checked-in). Rejected and cancelled applicants never receive broadcasts. A
  live recipient count is shown, sends are capped (`LIMIT_BROADCAST_RECIPIENTS`, default
  200) so they fit the function timeout, and each send is recorded in `chapter_broadcasts`
  for audit (the last send is shown in the composer). Good for sharing the Discord link
  and final details.
- **Event info**: a free-text panel (Discord link, schedule, venue) saved instantly with
  no email sent. Shown at the top of the participant event hub.

### Challenge Configuration (`/admin/chapters/<id>/challenges`)
- Create challenges with: title, description, sponsor, prize, judging criteria
- Define custom submission fields
- Upload challenge brief (PDF)
- Configure code review settings (models, weights, instructions)
- Toggle scored/unscored challenges

### Team Oversight (`/admin/teams`)
- View all teams with member lists
- Change team status
- Remove individual members (never the captain; blocked if the team would drop below `MIN_TEAM_SIZE`, default 2)
- Delete teams
- Admin overrides (audit-logged): change captain, add a member by email, move a member to another team
- Override a team's challenge selection (global admins): assign a challenge to a team that
  forgot to pick one, or change a team's existing pick to a different challenge. The control
  appears in the team row only while submissions are still open for the active chapter
  (status `challenge_selection`/`hacking`/`submissions_open` and the submission deadline not
  yet passed); the server action re-checks this gate, so the override is rejected once
  submissions close. Validates that the team belongs to the chapter and the challenge belongs
  to the chapter, and blocks a change when the team already submitted a project to its current
  challenge (delete that submission first to avoid orphaning it). Audit-logged with from/to
  challenge.

### Submissions (`/admin/submissions`)
- List every submission across all chapters (match, challenge, team, project, updated)
- Also shows teams that registered for a challenge but never submitted ("No submission")
- Click through to the full submission detail (`/admin/submissions/<id>`): description, tech stack, links/repo/fork, embedded files (pitch deck preview), and the AI code review
- Global admins see all submissions; chapter admins see only their own chapter's

### Score Management (`/admin/chapters/<id>/scores`)
- View aggregated jury rankings per challenge
- Individual juror vote inspection
- Manual score overrides (any placement or participation), attributable to a real
  challenge of the chapter (the challenge name is resolved server-side; without one
  the legacy "Manual Override" label is used)
- **Manual results mode**: when no jury votes exist (e.g. paper scoring at the event),
  the table lists every team registered for the chapter, pre-filled with each team's
  registered challenge, so a full final ranking can be entered from scratch. A clear
  warning banner explains that entries are admin overrides tracked in the audit log.
  Saving warns (soft confirm) when two teams share a placement within one challenge.
- Publish results (makes scores public, sets chapter to completed)
- Pre-publish consistency check: only finalized scores in the `scores` table are
  published (and surfaced on the public leaderboard). The page warns when jury
  results are displayed but not yet finalized into scores on the Jury page, so
  unfinalized results are not silently dropped at publish time. Publishing a
  chapter with genuinely no scores is still allowed (completes with an empty
  leaderboard) but explicitly confirmed.
- Send certificate emails after publishing: one email per team member with a
  personal participation certificate, plus a personal achievement certificate
  for placed members

### Certificate Designs (`/admin/chapters/<id>/certificates`)
- Global admins upload a custom certificate design per chapter and per
  variant (participation / achievement), e.g. with sponsor logos
- The uploaded design is a COMPLETE certificate (title, labels, field
  underlines, logos, signature); the platform only writes the values
  (hackathon name, awardee, team, rank/points, city and date) onto the
  design's field lines at fixed per-variant positions
  (`lib/certificates/layout.ts`); the signature field is never auto-filled
- A downloadable design-template PDF (one page per variant) marks exactly
  where each value lands
- PNG or JPEG only (react-pdf cannot draw WebP/AVIF; SVG banned repo-wide;
  design tools should export PNG, not PDF), max 5MB, recommended 2384x1684 px
  (A4 landscape at 200 dpi)
- Stored in the PRIVATE `certificate-backgrounds` Supabase Storage bucket
  (designs must not be enumerable before an event)
- Without an upload (or if the file goes missing) certificates fall back to
  the default EHL design; emailed links never break

### Jury Management (`/admin/jury`)
- Invite jury members by email (sends magic link)
- Assign jury to specific challenges
- Track voting progress (who has voted, who hasn't)
- View all jury assignments

### Check-in (`/admin/check-in`)
- QR code scanner using device camera
- Scans participant QR codes from acceptance emails
- Marks participants as checked in
- Shows check-in status per participant

### Partner Management (`/admin/partners`)
- Add partners per chapter
- Three tiers: Challenge, Tech, Community
- Logo upload to Supabase Storage
- Set display order

### Settings (`/admin/settings`)
- Admin email allowlist management
- Site-wide feature toggles (stored in `app_settings` DB table)
- Query limits overview with current values and env var names
- Audit log of admin actions

### Team Unlock Management (`/admin/chapters/<id>/unlocks`)
- Grant/revoke team access to specific chapters
- Used to control which teams can participate in which matches

---

## 7. Automated Systems

### Daily Cron Job
- Runs at midnight UTC via Vercel Cron
- Endpoint: `/api/cron/deadline-check`
- Checks all active deadlines (application, challenge selection, submission)
- Auto-transitions chapter status when deadlines pass
- Auto-locks submissions after submission deadline

### Rate Limiting
- All auth endpoints: 5 requests/minute
- Registration: 3 requests/minute
- Password reset: 3 requests/minute
- Applications: 3 requests/minute
- File uploads: 10/hour
- Emails: 3/hour per address
- General API: 1,000 requests/minute (high: 500+ participants share one WiFi at events)
- Certificate generation: 60 requests/minute per IP (CPU-intensive PDF rendering; sized for up to two personal certificates per member and whole teams behind one venue NAT)
- Powered by Upstash Redis, in-memory fallback (30 req/min) when Redis unavailable

### Email System
- 12 branded email templates (welcome, verification, acceptance, rejection, cancellation, certificates, etc.)
- Inline EHL logo in every email
- Rate limited per recipient
- Verification code emails are blocking (user waits for delivery)
- All other emails are fire-and-forget with error logging
