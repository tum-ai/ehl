-- One submission flow: authenticated database receipt, then queued GitHub work.
alter table public.submissions add column snapshot_sha text check (snapshot_sha ~ '^[a-f0-9]{40}$');
alter table public.submissions add column snapshot_error text;
create table public.submission_snapshot_jobs (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  revision integer not null default 1,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz,
  failures integer not null default 0,
  step jsonb not null default '{}', last_error text
);
create index submission_snapshot_due on public.submission_snapshot_jobs(next_attempt_at) where status in ('queued','running');
alter table public.submission_snapshot_jobs enable row level security;
revoke all on public.submission_snapshot_jobs from public,anon,authenticated;
grant all on public.submission_snapshot_jobs to service_role;

-- Every writer, including admin recovery, queues a job in the same transaction.
create function public.enqueue_submission_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.challenges c, jsonb_array_elements(c.submission_fields) f
   where c.id=new.challenge_id and f->>'type'='repo' and coalesce(new.fields->>(f->>'key'),'')<>'') then
   delete from public.submission_snapshot_jobs where submission_id=new.id;
   update public.submissions set fork_url=null,snapshot_sha=null,snapshot_error=null where id=new.id;
   return new;
 end if;
 insert into public.submission_snapshot_jobs(submission_id) values(new.id)
 on conflict(submission_id) do update set revision=submission_snapshot_jobs.revision+1,status='queued',next_attempt_at=now(),
   lease_token=null,lease_until=null,failures=0,step='{}',last_error=null;
 update public.submissions set fork_url=null,snapshot_sha=null,snapshot_error=null where id=new.id;
 return new;
end $$;
create trigger enqueue_submission_snapshot after insert or update of fields,updated_at,is_locked on public.submissions
 for each row execute function public.enqueue_submission_snapshot();

create function public.receive_submission(p_challenge uuid,p_team uuid,p_name text,p_description text,p_fields jsonb,p_stack jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.challenges; ch public.chapters; f jsonb; v text; result uuid;
begin
 if auth.uid() is null then raise exception 'Not authenticated.'; end if;
 select * into c from public.challenges where id=p_challenge;
 if c.id is null then raise exception 'Challenge not found.'; end if;
 -- Serialize receipt with deadline closure, not with a GitHub request.
 select * into ch from public.chapters where id=c.chapter_id for update;
 if not exists(select 1 from public.team_members where team_id=p_team and user_id=auth.uid()) then
   raise exception using message='You are not a member of this team.',detail='not_team_member'; end if;
 if not exists(select 1 from public.applications a join public.profiles p on p.email=a.email
   where p.id=auth.uid() and a.chapter_id=c.chapter_id and a.status='checked_in') then
   raise exception using message='You must be checked in to submit a project.',detail='not_checked_in'; end if;
 if not exists(select 1 from public.challenge_registrations where team_id=p_team and challenge_id=p_challenge) then
   raise exception using message='Your team is not registered for this challenge.',detail='not_registered'; end if;
 if exists(select 1 from public.submissions where challenge_id=p_challenge and team_id=p_team and is_locked) then
   raise exception using message='Submissions are locked. The deadline has passed.',detail='submissions_locked'; end if;
 if ch.status not in ('hacking','submissions_open') or clock_timestamp()>=coalesce(ch.submission_deadline,'infinity'::timestamptz) then
   raise exception using message='The submission deadline has passed.',detail='deadline_passed'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 200 or length(coalesce(p_description,''))>300 then raise exception 'Invalid project details.'; end if;
 if jsonb_typeof(p_fields) is distinct from 'object' or length(p_fields::text)>100000 then raise exception 'Invalid fields.'; end if;
 if jsonb_typeof(p_stack) is distinct from 'array' or jsonb_array_length(p_stack)>30 then raise exception 'Invalid technology stack.'; end if;
 if exists(select 1 from jsonb_array_elements(p_stack) x where jsonb_typeof(x)<>'string' or length(x::text)>102) then raise exception 'Invalid technology stack.'; end if;
 if exists(select 1 from jsonb_each(p_fields) where jsonb_typeof(value)<>'string' or length(value::text)>10002) then raise exception 'Invalid field value.'; end if;
 for f in select value from jsonb_array_elements(c.submission_fields) loop
   v := p_fields->>(f->>'key');
   if coalesce((f->>'required')::boolean,false) and coalesce(trim(v),'')='' then raise exception 'Required field missing: %',f->>'label'; end if;
   if f->>'type'='repo' and coalesce(v,'')<>'' and v !~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$' then raise exception 'Invalid GitHub repository URL.'; end if;
 end loop;
 insert into public.submissions(challenge_id,team_id,project_name,short_description,fields,tech_stack,updated_at)
 values(p_challenge,p_team,trim(p_name),p_description,p_fields,p_stack,clock_timestamp())
 on conflict(challenge_id,team_id) do update set project_name=excluded.project_name,short_description=excluded.short_description,
 fields=excluded.fields,tech_stack=excluded.tech_stack,updated_at=excluded.updated_at returning id into result;
 return result;
end $$;
create function public.guard_submission_receipt() returns trigger language plpgsql set search_path=public as $$
begin
 if current_user in ('anon','authenticated') then raise exception 'Use the submission receipt endpoint.'; end if;
 return new;
end $$;
create trigger guard_submission_receipt before insert or update on public.submissions for each row execute function public.guard_submission_receipt();

create function public.lock_submission_receipts(p_challenge uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.chapters ch join public.challenges c on c.chapter_id=ch.id where c.id=p_challenge for update of ch;
 update public.submissions set is_locked=true where challenge_id=p_challenge and not is_locked;
end $$;
create function public.claim_submission_snapshot(p_lease uuid) returns setof public.submission_snapshot_jobs
language plpgsql security definer set search_path=public as $$
begin
 return query with next as (
   select submission_id from public.submission_snapshot_jobs
   where (status='queued' and next_attempt_at<=now()) or (status='running' and lease_until<now())
   order by next_attempt_at,submission_id for update skip locked limit 1
 ) update public.submission_snapshot_jobs j set status='running',lease_token=p_lease,lease_until=now()+interval '90 seconds'
 from next n where j.submission_id=n.submission_id returning j.*;
end $$;
-- Every heartbeat/result must still own the revision. A resubmission invalidates old work.
create function public.update_submission_snapshot(p_id uuid,p_revision integer,p_lease uuid,p_status text,p_step jsonb,
 p_delay integer default 0,p_error text default null,p_fork text default null,p_sha text default null,p_failure boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.submission_snapshot_jobs where submission_id=p_id and revision=p_revision and status='running'
   and lease_token=p_lease and lease_until>now() for update;
 if not found then return false; end if;
 update public.submission_snapshot_jobs set status=p_status,step=p_step,last_error=p_error,failures=failures+p_failure::integer,
 next_attempt_at=now()+make_interval(secs=>greatest(0,p_delay)),lease_until=case when p_status='running' then now()+interval '90 seconds' else null end
 where submission_id=p_id;
 if p_fork is not null then
   update public.submissions set fork_url=p_fork,snapshot_sha=p_sha,snapshot_error=null where id=p_id;
   insert into public.code_reviews(submission_id,status,review_version,queued_at)
   select s.id,'queued',2,now() from public.submissions s join public.challenges c on c.id=s.challenge_id
   where s.id=p_id and s.is_locked and c.code_review_enabled and p_fork is not null
   on conflict(submission_id) do nothing;
 elsif p_error is not null then update public.submissions set snapshot_error=p_error where id=p_id;
 end if;
 return true;
end $$;

-- A small shared budget survives Actions restarts. It stores quota state, never tokens.
create table public.github_request_budgets (
 identity text primary key, next_request_at timestamptz, next_write_at timestamptz,
 pause_until timestamptz, remaining integer, reset_at timestamptz,
 hour_start timestamptz not null default now(), writes integer not null default 0
);
alter table public.github_request_budgets enable row level security;
revoke all on public.github_request_budgets from public,anon,authenticated;
grant all on public.github_request_budgets to service_role;
create function public.reserve_snapshot_request(p_identity text,p_write boolean) returns integer
language plpgsql security definer set search_path=public as $$
declare b public.github_request_budgets; until_at timestamptz;
begin
 insert into public.github_request_budgets(identity) values(p_identity) on conflict do nothing;
 select * into b from public.github_request_budgets where identity=p_identity for update;
 if b.hour_start<=now()-interval '1 hour' then b.hour_start=now(); b.writes=0; end if;
 until_at:=greatest(b.pause_until,b.next_request_at,case when p_write then b.next_write_at end,
   case when b.remaining<=500 and b.reset_at>now() then b.reset_at end,
   case when p_write and b.writes>=400 then b.hour_start+interval '1 hour' end);
 if until_at>now() then return ceil(extract(epoch from until_at-now()))::integer; end if;
 update public.github_request_budgets set next_request_at=now()+interval '300 milliseconds',
 next_write_at=case when p_write then now()+interval '3 seconds' else b.next_write_at end,
 hour_start=b.hour_start,writes=b.writes+p_write::integer,
 remaining=case when b.reset_at>now() then b.remaining-1 else null end where identity=p_identity;
 return 0;
end $$;
revoke all on function public.receive_submission(uuid,uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.receive_submission(uuid,uuid,text,text,jsonb,jsonb) to authenticated;
revoke all on function public.lock_submission_receipts(uuid),public.claim_submission_snapshot(uuid),
 public.update_submission_snapshot(uuid,integer,uuid,text,jsonb,integer,text,text,text,boolean),public.reserve_snapshot_request(text,boolean)
 from public,anon,authenticated;
grant execute on function public.lock_submission_receipts(uuid),public.claim_submission_snapshot(uuid),
 public.update_submission_snapshot(uuid,integer,uuid,text,jsonb,integer,text,text,text,boolean),public.reserve_snapshot_request(text,boolean) to service_role;

-- Preserve the resolved commit and completed copy on retries, including jury-only errors.
create function public.retry_submission_snapshot(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.submission_snapshot_jobs(submission_id)
 select s.id from public.submissions s join public.challenges c on c.id=s.challenge_id
 where s.id=p_id and exists(select 1 from jsonb_array_elements(c.submission_fields) f
   where f->>'type'='repo' and coalesce(s.fields->>(f->>'key'),'')<>'')
 on conflict(submission_id) do update set status='queued',failures=0,last_error=null,next_attempt_at=now(),lease_token=null,lease_until=null
 where submission_snapshot_jobs.status<>'running' or submission_snapshot_jobs.lease_until<now();
 if not found then raise exception 'Copy is already running or the submission has no repository.'; end if;
 update public.submissions set snapshot_error=null where id=p_id;
end $$;
revoke all on function public.retry_submission_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.retry_submission_snapshot(uuid) to service_role;
