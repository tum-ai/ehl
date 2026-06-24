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
  - "Download Certificate (PDF)" link for completed matches with published scores
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
- Requires authentication: only team members and admins can download
- A4 landscape, white background, printable
- Shows: team name, university, member names, match details, placement, points
- EHL branding with purple corner brackets and gold placement badge
- Immutably cached (generated once, served forever)
- Download link appears on dashboard for completed matches

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

### Challenge Selection
- After check-in, teams browse available challenges
- Each challenge shows: sponsor, description, prize, judging criteria, brief PDF
- Team registers for exactly one challenge per match
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
- Runs in GitHub Actions (avoids Vercel function timeout)
- Queue depth limited to 200 concurrent reviews (configurable via `LIMIT_CODE_REVIEW_QUEUE_DEPTH`)

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
- They **can**: score applications (screening) and check participants in.
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
- View CVs (downloaded from Google Drive)
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

### Submissions (`/admin/submissions`)
- List every submission across all chapters (match, challenge, team, project, updated)
- Also shows teams that registered for a challenge but never submitted ("No submission")
- Click through to the full submission detail (`/admin/submissions/<id>`): description, tech stack, links/repo/fork, embedded files (pitch deck preview), and the AI code review
- Global admins see all submissions; chapter admins see only their own chapter's

### Score Management (`/admin/chapters/<id>/scores`)
- View aggregated jury rankings per challenge
- Individual juror vote inspection
- Manual score overrides (any placement or participation)
- Publish results (makes scores public, sets chapter to completed)
- Send certificate emails to all teams after publishing

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
- Certificate generation: 10 requests/minute (CPU-intensive PDF rendering)
- Powered by Upstash Redis, in-memory fallback (30 req/min) when Redis unavailable

### Email System
- 12 branded email templates (welcome, verification, acceptance, rejection, cancellation, certificates, etc.)
- Inline EHL logo in every email
- Rate limited per recipient
- Verification code emails are blocking (user waits for delivery)
- All other emails are fire-and-forget with error logging
