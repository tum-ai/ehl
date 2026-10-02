-- Keep the existing receipt and worker. Accept only a server-verified version,
-- and never resolve a newer source branch while copying or closing a deadline.
alter table public.submissions add column repo_snapshots jsonb not null default '{}';
alter table public.submissions add column submission_revision integer not null default 0;

-- Shared preflight/final checks, callable only by the service role. The server
-- supplies the user from getUser(), never from participant input. Locks live
-- only for this short database transaction, not during GitHub verification.
create function public.submission_requirements(p_user uuid, p_challenge uuid, p_team uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.challenges; ch public.chapters; s public.submissions;
begin
 if p_user is null then raise exception 'Not authenticated.'; end if;
 select * into c from public.challenges where id=p_challenge;
 if c.id is null then raise exception 'Challenge not found.'; end if;
 select * into ch from public.chapters where id=c.chapter_id for update;
 select * into c from public.challenges where id=p_challenge for share;
 if not exists(select 1 from public.team_members where team_id=p_team and user_id=p_user) then
   raise exception using message='You are not a member of this team.',detail='not_team_member'; end if;
 if not exists(select 1 from public.applications a join public.profiles p on p.email=a.email
   where p.id=p_user and a.chapter_id=c.chapter_id and a.status='checked_in') then
   raise exception using message='You must be checked in to submit a project.',detail='not_checked_in'; end if;
 if not exists(select 1 from public.challenge_registrations where team_id=p_team and challenge_id=p_challenge) then
   raise exception using message='Your team is not registered for this challenge.',detail='not_registered'; end if;
 select * into s from public.submissions where challenge_id=p_challenge and team_id=p_team for update;
 if s.is_locked then raise exception using message='Submissions are locked. The deadline has passed.',detail='submissions_locked'; end if;
 if ch.status not in ('hacking','submissions_open') or clock_timestamp()>=coalesce(ch.submission_deadline,'infinity'::timestamptz) then
   raise exception using message='The submission deadline has passed.',detail='deadline_passed'; end if;
 return jsonb_build_object('entire_required',c.entire_required,'submission_fields',c.submission_fields,'revision',coalesce(s.submission_revision,0));
end $$;
revoke all on function public.submission_requirements(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submission_requirements(uuid,uuid,uuid) to service_role;

-- Participants cannot bypass the server checks by invoking the save directly.
drop function if exists public.receive_submission(uuid,uuid,text,text,jsonb,jsonb);
create function public.receive_submission(p_submission jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare r jsonb:=p_submission; requirements jsonb;
 f jsonb; cp jsonb; selection jsonb; v text; repo_count integer:=0; result uuid;
begin
 if jsonb_typeof(r) is distinct from 'object' or length(r::text)>1000000 then
   raise exception 'Invalid submission.'; end if;
 requirements:=public.submission_requirements((r->>'user_id')::uuid,(r->>'challenge_id')::uuid,(r->>'team_id')::uuid);
 if r->'requirements' is distinct from requirements then raise exception 'Submission or challenge changed. Please submit again.'; end if;
 if jsonb_typeof(r->'project_name') is distinct from 'string' or length(trim(r->>'project_name')) not between 1 and 200
   or length(coalesce(r->>'short_description',''))>300 then raise exception 'Invalid project details.'; end if;
 if jsonb_typeof(r->'fields') is distinct from 'object' or length((r->'fields')::text)>100000
   or exists(select 1 from jsonb_each(r->'fields') where jsonb_typeof(value)<>'string' or length(value::text)>10002) then raise exception 'Invalid fields.'; end if;
 if jsonb_typeof(r->'tech_stack') is distinct from 'array' or jsonb_array_length(r->'tech_stack')>30
   or exists(select 1 from jsonb_array_elements(r->'tech_stack') x where jsonb_typeof(x)<>'string' or length(x::text)>102) then raise exception 'Invalid technology stack.'; end if;
 if jsonb_typeof(r->'repo_snapshots') is distinct from 'object' then raise exception 'Repository verification is required.'; end if;
 for f in select value from jsonb_array_elements(requirements->'submission_fields') loop
   v:=r->'fields'->>(f->>'key');
   if coalesce((f->>'required')::boolean,false) and coalesce(trim(v),'')='' then raise exception 'Required field missing: %',f->>'label'; end if;
   if f->>'type'<>'repo' or coalesce(trim(v),'')='' then continue; end if;
   repo_count:=repo_count+1;
   selection:=r->'repo_snapshots'->(f->>'key');
   if v !~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'
     or selection is null or jsonb_typeof(selection)<>'object'
     or selection->>'repo_url' is distinct from regexp_replace(regexp_replace(trim(v),'/$',''),'[.]git$','')
     or coalesce(selection->>'frozen_sha','') !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(selection->'repository_id') is distinct from 'number'
     or (selection->>'repository_id')::numeric<1
     or selection->'entire_required' is distinct from requirements->'entire_required'
     or jsonb_typeof(selection->'checkpoint_manifest') is distinct from 'array' then raise exception 'Invalid verified repository version.'; end if;
   if (requirements->>'entire_required')::boolean and jsonb_array_length(selection->'checkpoint_manifest')=0 then
     raise exception using message='This challenge requires an Entire session record.',detail='entire_missing'; end if;
   for cp in select value from jsonb_array_elements(selection->'checkpoint_manifest') loop
     if coalesce(cp->>'sha','') !~ '^[a-f0-9]{40}$' or coalesce(cp->>'ref','') !~ '^refs/(entire/checkpoints/[^/]+/[^/]+|entire/checkpoints/v1[.]1|heads/entire/checkpoints(/v1)?)$' then
       raise exception 'Invalid verified checkpoint.'; end if;
   end loop;
 end loop;
 if (select count(*) from jsonb_object_keys(r->'repo_snapshots'))<>repo_count then raise exception 'Unexpected verified repository.'; end if;
 -- Recheck immediately before the write, including time spent validating input.
 perform public.submission_requirements((r->>'user_id')::uuid,(r->>'challenge_id')::uuid,(r->>'team_id')::uuid);
 insert into public.submissions(challenge_id,team_id,project_name,short_description,fields,tech_stack,updated_at,repo_snapshots,submission_revision)
 values((r->>'challenge_id')::uuid,(r->>'team_id')::uuid,trim(r->>'project_name'),r->>'short_description',r->'fields',r->'tech_stack',clock_timestamp(),r->'repo_snapshots',(requirements->>'revision')::integer+1)
 on conflict(challenge_id,team_id) do update set project_name=excluded.project_name,short_description=excluded.short_description,
   fields=excluded.fields,tech_stack=excluded.tech_stack,updated_at=excluded.updated_at,repo_snapshots=excluded.repo_snapshots,submission_revision=excluded.submission_revision returning id into result;
 return result;
end $$;
revoke all on function public.receive_submission(jsonb) from public,anon,authenticated;
grant execute on function public.receive_submission(jsonb) to service_role;

create or replace function public.enqueue_submission_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.challenges c,jsonb_array_elements(c.submission_fields) f
   where c.id=new.challenge_id and f->>'type'='repo' and coalesce(new.fields->>(f->>'key'),'')<>'') then
   delete from public.submission_snapshot_jobs where submission_id=new.id;
   update public.submissions set fork_url=null,snapshot_sha=null,snapshot_error=null where id=new.id;
   return new;
 end if;
 insert into public.submission_snapshot_jobs(submission_id,revision) values(new.id,new.submission_revision)
 on conflict(submission_id) do update set revision=new.submission_revision,status='queued',next_attempt_at=now(),
   lease_token=null,lease_until=null,failures=0,step='{}',last_error=null;
 update public.submissions set fork_url=null,snapshot_sha=null,snapshot_error=null where id=new.id;
 -- A review of an earlier accepted version must never become the final review.
 delete from public.code_reviews where submission_id=new.id;
 return new;
end $$;
drop trigger enqueue_submission_snapshot on public.submissions;
create trigger enqueue_submission_snapshot after insert or update of fields,updated_at on public.submissions
 for each row execute function public.enqueue_submission_snapshot();

create or replace function public.lock_submission_receipts(p_challenge uuid) returns void language plpgsql security definer set search_path=public as $$
declare locked_id uuid;
begin
 perform 1 from public.chapters ch join public.challenges c on c.chapter_id=ch.id where c.id=p_challenge for update of ch;
 for locked_id in update public.submissions set is_locked=true where challenge_id=p_challenge and not is_locked returning id loop
   -- Keep exact inputs and completed copies. Invalidate an in-flight lease so
   -- the next run also performs final-only jury/review work, without new code.
   update public.submission_snapshot_jobs set status='queued',next_attempt_at=now(),lease_token=null,lease_until=null
     where submission_id=locked_id;
 end loop;
end $$;

create or replace function public.update_submission_snapshot(p_id uuid,p_revision integer,p_lease uuid,p_status text,p_step jsonb,
 p_delay integer default 0,p_error text default null,p_fork text default null,p_sha text default null,p_failure boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare s public.submissions; part record; first_key text;
begin
 select * into s from public.submissions where id=p_id for update;
 if s.submission_revision is distinct from p_revision then return false; end if;
 perform 1 from public.submission_snapshot_jobs where submission_id=p_id and revision=p_revision and status='running'
   and lease_token=p_lease and lease_until>now() for update;
 if not found then return false; end if;
 for part in select * from jsonb_each(p_step) loop
   if (part.value-'fork_url'-'revision'-'complete'-'invited') is distinct from s.repo_snapshots->part.key then
     raise exception 'Copy inputs differ from the accepted submission.'; end if;
 end loop;
 if p_fork is not null then
   select f->>'key' into first_key from public.challenges c,jsonb_array_elements(c.submission_fields) f
     where c.id=s.challenge_id and f->>'type'='repo' and coalesce(s.fields->>(f->>'key'),'')<>'' limit 1;
   if p_sha is distinct from s.repo_snapshots->first_key->>'frozen_sha' or p_sha is null then raise exception 'Copied commit differs from the accepted submission.'; end if;
 end if;
 update public.submission_snapshot_jobs set status=p_status,step=p_step,last_error=p_error,failures=failures+p_failure::integer,
 next_attempt_at=now()+make_interval(secs=>greatest(0,p_delay)),lease_until=case when p_status='running' then now()+interval '90 seconds' else null end
 where submission_id=p_id;
 if p_fork is not null then
   update public.submissions set fork_url=p_fork,snapshot_sha=p_sha,snapshot_error=null where id=p_id;
   insert into public.code_reviews(submission_id,status,review_version,queued_at)
   select s.id,'queued',2,now() from public.challenges c where c.id=s.challenge_id and s.is_locked and c.code_review_enabled
   on conflict(submission_id) do nothing;
 elsif p_error is not null then update public.submissions set snapshot_error=p_error where id=p_id;
 end if;
 return true;
end $$;
-- Recreating a lost job must not reset an accepted revision to the queue's
-- default. Existing progress is preserved when retrying a failed copy.
create or replace function public.retry_submission_snapshot(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.submissions where id=p_id for update;
 insert into public.submission_snapshot_jobs(submission_id,revision)
 select s.id,s.submission_revision from public.submissions s
 where s.id=p_id and s.submission_revision>0 and s.repo_snapshots<>'{}'::jsonb
 on conflict(submission_id) do update set status='queued',failures=0,last_error=null,next_attempt_at=now(),lease_token=null,lease_until=null
 where submission_snapshot_jobs.status<>'running' or submission_snapshot_jobs.lease_until<now();
 if not found then raise exception 'Copy is already running or the submission has no verified repository.'; end if;
 update public.submissions set snapshot_error=null where id=p_id;
end $$;
notify pgrst,'reload schema';
