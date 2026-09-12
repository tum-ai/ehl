# Operational Runbooks

Repeatable one-off procedures an operator runs around a live event. Each entry
is written so the next person can execute it without reconstructing the
reasoning: what it does, the exact commands, and the traps that already bit us.

Related: `docs/PRE-EVENT.md` (event-day checklist), `docs/SETUP.md` (deployment).

---

## Sponsor credit code distribution

Mail each checked-in participant ONE sponsor credit code (OpenAI, or any sponsor
with per-person codes). Codes are single-use and unrecoverable once sent, so the
procedure is built around never re-rolling an assignment.

Script: `scripts/send-credit-codes.ts`. Allocation logic: `lib/credit-codes.ts`
(pure, unit tested). Email template: `lib/emails/credit-code.tsx`.

**1. Build the code pool.** Sponsors deliver a CSV whose columns vary between
events. Extract the code column into a plain one-code-per-line file, and drop
any codes the sponsor already used at their own booth:

```bash
tail -n +2 <sponsor-file>.csv | awk -F, '{print $2}' > codes-pool.txt
```

**2. Export the recipients.** Recipients are `applications` rows with
`status = 'checked_in'` for the event's chapter. Write two files: a
one-email-per-line list, and a `name,email` CSV used for the greeting.

**3. Dry run.** Writes the assignment, the leftovers and an HTML preview; sends
nothing:

```bash
CHAPTER_NAME="EHL <City>" NOTE="<value, validity, redemption deadline>" \
npx tsx scripts/send-credit-codes.ts \
  --emails emails.txt --codes codes-pool.txt --names names.csv --out-dir <dir>
```

Check three things before going further: the recipient/leftover counts match
what you expect, the preview email has the right redeem URL and chapter name,
and no one is listed as unserved.

**4. Live send**, reusing the frozen assignment from step 3:

```bash
SEND=true CHAPTER_NAME=... NOTE=... \
npx tsx scripts/send-credit-codes.ts \
  --assignments <dir>/credit-code-assignments.csv --names names.csv --out-dir <dir>
```

**5. Reconcile.** Produce one row per original code with
`status ∈ {sent, leftover, already_used}` plus recipient and timestamp, so every
code the sponsor gave you is accounted for. Keep the sponsor's original file
untouched alongside it.

Why the dry run is not optional:

- It **freezes the email→code mapping to disk** before any mail moves. The live
  send consumes that file, so a crash mid-send resumes with the identical
  mapping. Recomputing would hand different codes to people already partly
  served.
- It is the only chance to see the rendered email before the recipients do. A
  wrong redeem URL is unfixable once the codes are burned.
- It surfaces arithmetic problems (short pool, duplicate addresses) for free.

It does **not** test SMTP. For that, add `--limit 1` to a live send addressed to
yourself; it costs one spare code.

Other properties worth knowing: every successful send is appended to
`credit-code-sent.log` immediately and a re-run skips those addresses, so
retrying after failures is safe. Codes are drawn from the BOTTOM of the pool
upward, so the untouched remainder is the TOP block of the sponsor's file.
Failures land in `credit-code-failures.csv` and their codes are NOT logged as
sent, so re-running with `--assignments` retries exactly those people.

**Keep every generated file out of the repo.** This repo is public; the codes
are live money.

---

## Exporting the teams registered for a challenge

Registrations live in `challenge_registrations`, one row per team, with a
**frozen `roster` array** captured at the moment the team registered.

**The trap: the frozen roster drifts from live team membership.** Someone who
accepts a team invite after the team registered is a full `team_members` row but
is absent from the registration roster. At Zurich this affected 3 of 10 teams,
always as a late addition, and it made one team look like it had two members
when it actually had three.

So before treating any export as final, diff the two per registration:

```
frozen = challenge_registrations.roster
live   = team_members where team_id = registration.team_id
```

and report the difference rather than silently picking one. Which one is
authoritative is a call for the organisers (re-register vs. admin-add the late
joiner), but the export must not hide the discrepancy. Re-run the export close
to the deadline: registration stays open, so any export is a snapshot.

Team sizes are bounded by `MIN_CHALLENGE_ROSTER` (2) and `MAX_TEAM_SIZE` (5) in
`lib/config/limits.ts`. A two-person team is legal; only a solo team is refused.

---

## Recovering missing repository snapshots

Every submission with a GitHub repo field is forked into the EHL snapshot org so
the jury reads a copy under EHL control. When the jury judges **private** repos,
that fork is the only thing they can open: without it they get a 404 on the
team's own repository.

### When this bites

The fork is created by the GitHub bot account. It can fail for reasons that have
nothing to do with the team:

| Cause | Error shape | Fix |
|---|---|---|
| GitHub secondary rate limit (fork creation is throttled; a deadline rush of 30+ teams, each retrying, will hit it) | `Could not fork repository (403)` | Wait for the window to clear, then retry |
| Bot token expired | `(401)` | Rotate the token, then retry |
| Token not SSO-authorized for the snapshot org, or missing `repo` scope | `(403)` | Re-authorize in GitHub org settings, then retry |
| Team made the repo private or revoked the bot's access after verifying | `(404)` | Ask the team to re-invite the bot, then retry |

Neither the submit path nor the deadline lock fails the participant when this
happens, by design: the submission is saved either way. The cost of that choice
is that the gap is silent unless an operator looks, which is what this runbook
is for.

### Finding what is missing

`submissions.fork_url IS NULL` is the durable record of a fork still owed.

- **In the admin panel**: `/admin/submissions` shows a **Snapshot** column and, when
  anything is missing, a banner counting them with a per-match retry button.
- **In SQL** (when you want the list outside the UI):

```sql
select t.name as team, s.fields, s.fork_url
from submissions s
join teams t on t.id = s.team_id
join challenges c on c.id = s.challenge_id
where c.chapter_id = '<chapter-id>'
  and s.fork_url is null;
```

### Retrying

1. Fix the underlying cause first (wait out the rate limit, rotate the token, or
   get the bot re-invited). Retrying into the same 403 just burns the limit.
2. Press **Retry N in \<match\>** on `/admin/submissions`, or **Retry snapshot** on a
   single submission's detail page.
3. Read the result. On failure it prints the live GitHub error per team, which
   tells you which of the four causes above you are actually in.
4. Repeat until the banner is gone. The retry is idempotent: a submission that
   already has a fork is skipped without calling GitHub, and an existing fork is
   synced rather than recreated.

### Do this BEFORE judging opens

A juror who cannot open a repo will either score it as broken or stop to ask,
and both cost more than a two-minute check. Confirm the banner on
`/admin/submissions` is clear once the submission deadline has locked and before
jury links go out.

### Preventing it in the first place

- Check the bot token's expiry and scopes before the event (see `docs/PRE-EVENT.md`).
- Encourage teams to submit early and edit later: submission is an upsert, so
  re-submitting updates the row, and early submissions spread fork calls out
  instead of concentrating them into the final ten minutes.
