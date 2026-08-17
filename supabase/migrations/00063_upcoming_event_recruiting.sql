-- Dashboard discovery for the current or next event. Application rows are
-- private, so expose only the public chapter fields and IDs of public teams
-- whose president has an active application linked to that same team.
create or replace function public.get_upcoming_event_recruiting()
returns table (
  chapter_id uuid,
  chapter_name text,
  chapter_slug text,
  chapter_city text,
  chapter_date date,
  chapter_date_end date,
  team_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with next_chapter as (
    select c.id, c.name, c.slug, c.city, c.date, c.date_end
    from public.chapters c
    where c.status not in ('draft', 'completed')
      and c.date is not null
      and coalesce(c.date_end, c.date) >= current_date
    order by
      case when c.date <= current_date then 0 else 1 end,
      case when c.date <= current_date then c.date end desc,
      case when c.date > current_date then c.date end asc,
      c.match_number asc
    limit 1
  ),
  eligible_teams as (
    select t.id as team_id
    from next_chapter nc
    join public.teams t
      on t.status = 'active'
     and t.looking_for_members = true
    join public.profiles president
      on president.id = t.president_user_id
    where exists (
      select 1
      from public.applications application
      where application.chapter_id = nc.id
        and application.existing_team_id = t.id
        and lower(application.email) = lower(president.email)
        and application.status in ('pending', 'waitlisted', 'accepted', 'checked_in')
    )
  )
  select
    nc.id,
    nc.name,
    nc.slug,
    nc.city,
    nc.date,
    nc.date_end,
    et.team_id
  from next_chapter nc
  left join eligible_teams et on true;
$$;

comment on function public.get_upcoming_event_recruiting() is
  'Returns the current or next public event and public team IDs whose president has an active application linked to that team.';

revoke execute on function public.get_upcoming_event_recruiting() from public, anon;
grant execute on function public.get_upcoming_event_recruiting() to authenticated, service_role;
