# Certificates v2: personal certificates, point-free participation, custom designs

Status: **shipped** (PR #93, merged 2026-07-11; Package 1 and Package 2 Stage 1) · Written: 2026-07-11
Origin: operator feature request after Season 1 events.
Open question 1 (§6) resolved: `profiles.name` as a single field is fine, no split.
Stage 2 (visual position editor) remains deferred.

This document contains enough background to implement the feature without re-deriving
the current architecture. Read "Current implementation" first; every design decision
below builds on it.

---

## 1. Requirements (from the operator)

1. **Certificate per team** — already exists, keep as-is.
2. **Certificate per person** — new: each team member can download an individual
   certificate carrying their own name (first/last name), with the team as context.
3. **No points on participation certificates** — the participation variant currently
   shows "Participant · X points"; it must show no points at all. The achievement
   variant (placements 1-5) keeps placement + points.
4. **Placed teams additionally get a participation certificate** — a team that placed
   1st-5th should be able to download BOTH its achievement certificate AND a neutral
   participation certificate (e.g. to share without revealing ranking).
5. **Custom certificate designs per event (stretch)** — admins upload a background
   design per match (sponsor branding) instead of the hardcoded EHL design. The full
   ask was a drag-and-drop variable-placement editor; we scope this in two stages
   (see §4) and only commit to Stage 1 for now.

Packaging:
- **Package 1** = requirements 2 + 3 + 4 (small, ship together, ~1.5-2 days incl. tests)
- **Package 2 / Stage 1** = background upload with fixed text positions (~1-2 days)
- **Package 2 / Stage 2** = visual position editor (deferred until Stage 1 proves insufficient)

---

## 2. Current implementation (as of commit history July 2026)

### Files

| File | Role |
|---|---|
| `lib/certificates/template.tsx` | The PDF design: a `@react-pdf/renderer` React component (`CertificateDocument`). A4 landscape, white page, purple corner brackets, gold accents, Helvetica. Renders EITHER an achievement badge (gold, placement label + points) OR a participation badge (purple outline, "Participant · X points") based on `isPlaced`. |
| `app/api/certificates/[chapterId]/[teamId]/route.tsx` | GET route that authorizes, fetches score/team/chapter/members via `createAdminClient()`, renders the PDF with `ReactPDF.renderToStream`, returns it with `Cache-Control: private, no-store`. |
| `lib/certificate-token.ts` | Stateless HMAC capability token bound to `${chapterId}:${teamId}` (SHA-256 HMAC, base64url, constant-time verify, key derived from `CERTIFICATE_LINK_SECRET` falling back to `VERIFICATION_ENCRYPTION_KEY`, namespaced with a `certificate-link:` label). Lets emailed links work without login while preventing enumeration (certificates contain member names = PII). |
| `lib/actions/admin.ts` → `sendCertificateEmails(chapterId)` | Admin action (guarded by `requireAdminAction()`). Requires chapter status `completed`; iterates published `scores` rows; per team sends ONE email to all member addresses with ONE team-bound token link. Logs `chapter.certificates_sent` to the audit log. |
| `lib/emails/certificate.tsx` + `lib/emails/render.ts` | Branded email template ("Certificate Ready", match/location/date/result rows, download button). |
| `app/(participant)/dashboard/page.tsx` (~line 263) | Team dashboard shows a "Download Certificate (PDF)" link per completed chapter (session-authenticated path, no token). |
| `app/admin/(dashboard)/chapters/[id]/scores/page.tsx` (~line 219, 582) | Admin button that triggers `sendCertificateEmails` (with confirm dialog). |
| `lib/ratelimit.ts` → `certLimiter` | Per-IP rate limit applied FIRST in the route (PDF rendering is CPU-heavy and the route is reachable unauthenticated via token). |

### Authorization model of the route (must be preserved)

The route accepts EITHER:
- a valid capability token for exactly this `(chapterId, teamId)` (email path, no login), OR
- a session where the user is an admin or a member of `teamId` (dashboard path).

Rate limiting runs before any of this. The score row must exist with `published = true`,
otherwise 404 — **certificates only exist once scores are published**. This gate is
intentional and stays.

### Data used per certificate

`scores(placement, points, challenge_name, published)`, `teams(name, university)`,
`chapters(name, city, country, date, date_end)`, `team_members → profiles(name)`.
`isPlaced` today means `placement !== null && placement <= 5`.

### Existing tests

- `tests/certificate-token.test.ts` — token generation/verification unit tests
- `tests/certificate-route-auth.test.ts` — route authorization unit tests
- `e2e/simulation/07-scoring-leaderboard.sim.ts` — touches scoring flow

---

## 3. Package 1: personal certs, point-free participation, dual certs for placed teams

No DB migration needed. Everything derives from existing tables.

### 3.1 Route API shape (backwards compatible)

Keep the path `/api/certificates/[chapterId]/[teamId]` and add two optional query params:

- `variant=achievement|participation` — default: `achievement` if the team placed 1-5,
  else `participation` (i.e. today's behavior). `variant=participation` is allowed for
  any team; `variant=achievement` for a non-placed team is a 404/400 (nothing to certify).
- `member=<userId>` — renders the personal variant for that member. The route must
  verify the user is actually a member of `teamId` (via `team_members`) and fetch the
  profile name; 404 if not a member or the profile has no name.

**Why query params instead of new path segments:** the default URL stays identical, so
every certificate link already sent by email keeps working unchanged.

### 3.2 Token extension (critical: keep old emailed links valid)

Today's token = HMAC over `${chapterId}:${teamId}`. Old links carry exactly that token
with no extra params. Design:

- **Legacy tokens stay valid for the default request** (no `variant`, no `member`
  params). `verifyCertificateToken(chapterId, teamId, token)` unchanged.
- **New links use a v2 payload**: HMAC over
  `v2:${chapterId}:${teamId}:${member || "team"}:${variant}`
  (UUIDs contain no colons, so the separator is unambiguous — same argument as the
  existing code comment). Add `certificateTokenV2(...)` / `verifyCertificateTokenV2(...)`
  alongside the legacy functions in `lib/certificate-token.ts`, same key derivation.
- Route logic: if `member` or `variant` params are present, only a matching v2 token
  (or a valid session: admin, or the member themselves / any team member for team
  variants) authorizes. A v1 token must NOT authorize a personal certificate — it was
  minted for the team default only.
- Session path: a logged-in team member may fetch any variant/member cert **of their
  own team** (members' names are already mutually visible on the team). Admins: everything.

### 3.3 Template changes (`lib/certificates/template.tsx`)

Extend `CertificateProps`:

```ts
personName?: string | null;   // set => personal certificate
variant: "achievement" | "participation";
```

- `variant === "participation"`: title "Certificate of Participation", purple badge
  with **"Participant"** and no points line (requirement 3). Never render points or
  placement in this variant, even for placed teams (that's the point of requirement 4).
- `variant === "achievement"`: unchanged (gold badge, placement label, points).
- Personal certificate: "Awarded to" → the person's name (current `teamName` slot);
  team name moves into the details row (`Team: <name>`); member list line is omitted;
  university stays.
- Replace the old `isPlaced`/`points`-driven branching with the explicit `variant` prop
  (the route computes the default variant; the template stops guessing).

### 3.4 Email changes

`sendCertificateEmails` currently sends one email per team (all members in `to:`).
Change to **one email per member** (required, since each member gets a personal link):

- Per member: personal-cert link (v2 token, `member=<userId>`, default variant)
  + team-cert link (existing default URL, legacy token — keeps one stable URL shape)
  + for placed teams additionally the team participation link
  (`variant=participation`, v2 token).
- Update `lib/emails/certificate.tsx`: greeting uses the member name, buttons/links for
  each available certificate. Remove the raw points from the "Result" row for non-placed
  teams (mirror requirement 3; placed teams keep `1st Place (+8 pts)`).
- Volume note: N emails instead of 1 per team (~4-6x). Keep the current awaited
  `sendEmail` loop (this is a long-running admin action, not a response-deferred path),
  but return `{ sent, failed }` counts per member and keep the audit-log event.
  Per repo rule "Show all errors in admin UX": surface partial failures in the admin UI.

### 3.5 Dashboard changes

`app/(participant)/dashboard/page.tsx`: where one "Download Certificate (PDF)" link
renders today, render up to three (session-authenticated, no tokens needed):
- "Your certificate (personal)" → `?member=<own userId>`
- "Team certificate" → default URL
- "Participation certificate" → `?variant=participation` (only when the team placed)

### 3.6 Rate limiting

`certLimiter` is per-IP and now serves up to ~3x the PDFs per legitimate user session.
Check the configured window in `lib/ratelimit.ts` / `lib/config/limits.ts`; bump if it
would block a member downloading all three certificates in quick succession.

### 3.7 Tests (per repo test discipline — same PR)

- `tests/certificate-token.test.ts`: v2 token round-trip; v1 token rejected for
  member/variant requests; cross-member and cross-variant token reuse rejected.
- `tests/certificate-route-auth.test.ts`: personal cert for non-member 404s; v1 token +
  `member` param → 401/403; session member can fetch own-team variants but not other
  teams'; `variant=achievement` for unplaced team → error.
- Template/unit: participation variant contains no points string; personal variant
  contains the person's name and the team in details.
- E2E (`hackathon-lifecycle.spec.ts`, append-only): after publish, dashboard shows the
  new links and each returns `content-type: application/pdf`.
- Docs: update `docs/FEATURES.md` (participant + admin sections).

---

## 4. Package 2: custom certificate designs per match

### Stage 1 — background upload, fixed text positions (commit to this)

**Concept:** the admin uploads a full-page background image per chapter and per variant
(participation / achievement). The PDF route draws the image full-bleed and lays the
existing text block on top at fixed, documented positions. No editor. Operators get a
design template file (A4 landscape, 842×595 pt) marking the areas the text will occupy;
sponsors design around them. If no upload exists → current hardcoded EHL design
(fallback, zero regression).

**File format decision: PNG/JPEG only, no PDF upload.**
- `@react-pdf/renderer`'s `<Image>` supports JPEG/PNG only — a raster background slots
  into the existing pipeline as one absolutely-positioned full-page `<Image>`.
- Accepting PDF backgrounds would force a second rendering stack (e.g. pdf-lib to stamp
  text onto an uploaded PDF) — more code, and uploaded PDFs are a nastier parsing surface.
- Repo upload rule (MIME whitelist, never SVG) applies; for this feature restrict
  further to `image/png` + `image/jpeg` (react-pdf can't render WebP/AVIF). Enforce
  server-side, cap size (~5 MB), recommend 2384×1684 px (200 dpi A4 landscape).

**Storage:** Supabase Storage, new **private** bucket `certificate-backgrounds`
(partner logos are public; these shouldn't be enumerable before an event). Path:
`<chapterId>/<variant>.<ext>`. The route fetches the image via `createAdminClient()`
at render time and passes it to react-pdf as a buffer/data URI (never a public URL).

**DB:** new migration (next free number; check `supabase/migrations/`), table
`chapter_certificate_designs`:

```sql
chapter_id uuid not null references chapters(id) on delete cascade,
variant    text not null check (variant in ('participation','achievement')),
storage_path text not null,
uploaded_by uuid references profiles(id),
created_at / updated_at timestamptz,
primary key (chapter_id, variant)
```

RLS: deny-all for anon/authenticated; admin paths use the admin client — mirror the
`chapter_communications` pattern (admin-only side table, NEVER columns on the
publicly-readable `chapters` row).
**Repo rule:** the migration MUST get a probe entry in `scripts/migration-checks.ts`
in the same PR, update the migration count in `CLAUDE.md`, and be applied to BOTH
databases via `scripts/db-migrate.sh`.

**Admin UI:** section on `app/admin/(dashboard)/chapters/[id]/` (near the scores /
communications panels): two upload slots (participation / achievement) with preview,
replace and remove, plus a "download design template" link. Server-side validation:
`requireAdminAction()`, MIME + size checks at the boundary. Upload via an API route
(file upload, matching existing upload patterns), not a server action.

**Text-position spec (single source of truth):** define the layout constants in one
module, e.g. `lib/certificates/layout.ts` (title block Y, name block Y, badge Y,
details row Y, footer Y — all as pt offsets on 842×595). The template imports them for
BOTH the default design and the custom-background mode, so the documented safe areas
can't drift from the code. Export the same constants to generate/maintain the operator
design template.

**Tests:** upload validation (MIME/size/auth), route renders with and without a custom
background, fallback when the storage object is missing (must fall back to default, not
500 — a certificate link in someone's inbox must never break because a design was
deleted). Docs: `docs/FEATURES.md`, `docs/SETUP.md` (new bucket), `CLAUDE.md`
(migration count + structure tree if `lib/certificates/layout.ts` is added).

### Stage 2 — visual position editor (deferred, do NOT build yet)

Free placement of text variables (drag-and-drop or click-to-place) over the uploaded
background, per chapter+variant: a coordinate/style JSON per text element
(`{field, x, y, fontSize, color, align}`) stored next to the design row, a canvas-based
admin editor, and template rendering driven by that JSON. This is a mini page-builder
(roughly a week plus maintenance). Only start it if operators confirm after using
Stage 1 that fixed positions are actually insufficient. Stage 1's `layout.ts` constants
are deliberately the same shape as this JSON, so Stage 2 becomes "make the constants
per-chapter data" rather than a rewrite.

---

## 5. Constraints & pitfalls checklist (repo-specific)

- **Never `createAdminClient()` in participant-facing paths** — the certificate route
  is the sanctioned exception because it does its own auth (token or session +
  membership check) before any query. Keep that ordering.
- Certificates require `scores.published = true` and chapter `completed` — do not
  weaken; operators rely on withholding publication to withhold certificates.
- Old emailed links must keep working (token v1 path, §3.2).
- Email: this admin action awaits sends in a loop — fine; anything moved into a
  request/response path must use `sendEmailAfterResponse()` (Vercel freeze rule).
- No em dashes in user-visible text (certificates, emails, UI).
- Every new migration → probe in `scripts/migration-checks.ts` (unit test enforces it),
  apply to production AND test DB.
- Full gate before PR: `pnpm typecheck && pnpm test && pnpm build` +
  `pnpm test:e2e:lifecycle`; dual review (independent Claude reviewer + Codex) before merge.

## 6. Open questions for the operator

1. Personal certificates: exact name source is `profiles.name` (one field, not split
   first/last). OK, or do they need split fields? (Splitting would require a profile
   schema change — push back unless truly needed.)
2. Stage 1 fixed-position trade-off accepted? (Proposed and pending their reply.)
3. Should personal certificates also come in both variants for placed teams (personal
   achievement AND personal participation)? Plan assumes yes — it falls out of the
   same `variant` × `member` matrix for free.
