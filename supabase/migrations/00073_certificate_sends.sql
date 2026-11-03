-- Per-person record of certificate emails, so "Send Certificates" is idempotent.
--
-- sendCertificateEmails() mailed every member of every scored team on every
-- press and logged only a total. A second press (for example after scores were
-- added for teams the first press missed) re-sent everyone who already had
-- theirs, and nothing could tell who had actually received one. This mirrors
-- application_rsvps (00065) and finale_invites (00068): the row is inserted
-- BEFORE the email and deleted again if the send fails, so "row exists" means
-- "already sent", and the primary key makes two concurrent presses unable to
-- mail the same person twice.
--
-- Service-role only (RLS on, no policies), like the other admin send ledgers.

create table if not exists certificate_sends (
  chapter_id    uuid not null references chapters(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  email_sent_at timestamptz not null default now(),
  primary key (chapter_id, user_id)
);

alter table certificate_sends enable row level security;

-- Backfill past sends so the first press after this change does not re-mail
-- chapters that were already sent. Conservative: a member counts as sent only
-- if a "chapter.certificates_sent" event for that chapter happened AFTER both
-- their team's score was published and they joined the team, i.e. they were a
-- recipient of that press. Members a press could not have reached (score
-- published or joined later) stay unrecorded and are mailed on the next press.
--
-- Only LEGACY events count, and only those with zero failures: a legacy event
-- holds a total, not who received it, so one with failures cannot say which
-- members were reached. Events written by the new send record a `remaining`
-- count and are excluded: from then on certificate_sends itself is the record,
-- so re-applying this file can never mark a member the new send did not reach.
-- Limit: publishScores re-stamps published_at on every publish, so a chapter
-- re-published after a legacy send would leave those members unrecorded (they
-- would be mailed once more on the next press, never skipped).
insert into certificate_sends (chapter_id, user_id, team_id, email_sent_at)
select distinct on (sc.chapter_id, tm.user_id)
       sc.chapter_id, tm.user_id, sc.team_id, e.created_at
from scores sc
join team_members tm on tm.team_id = sc.team_id
join profiles p on p.id = tm.user_id and p.email is not null and p.name is not null
join event_log e
  on e.action = 'chapter.certificates_sent'
 and e.entity_id = sc.chapter_id::text
 and not coalesce((e.delta -> 'created') ? 'remaining', false)
 and coalesce((e.delta -> 'created' ->> 'failed')::int, 0) = 0
 and sc.published
 and sc.published_at is not null
 and e.created_at >= sc.published_at
 and (tm.joined_at is null or e.created_at >= tm.joined_at)
order by sc.chapter_id, tm.user_id, e.created_at
on conflict (chapter_id, user_id) do nothing;
