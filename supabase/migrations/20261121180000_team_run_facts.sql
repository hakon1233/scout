-- Team runs get what Worker runs get.
--
-- team_claim_runs and team_start_run (20261121070000_team_runner) returned
-- only the topic, the doc and the search budget, so the Scout team's public
-- topics were researched without their brief settings and without the last
-- two sections that keep a run from repeating stories. Now one function,
-- run_facts, says what a run of an interest needs to know, and claim_queued
-- (so claim_runs), team_claim_runs and team_start_run all return its row.

-- What a run of one interest needs: its topic and intent doc, the owner's
-- search budget, its brief settings, its last two ready sections (newest
-- first, [{ "date": finished_at, "section_md": … }]), its cadence and when its
-- last story landed (the last ready run with coverage 'covered').
create function public.run_facts(p_interest uuid)
returns table (
  topic text,
  doc text,
  searches_per_run integer,
  brief_length text,
  story_count smallint,
  stories_relevant_only boolean,
  evergreen boolean,
  search_locale text,
  brief_language text,
  prior jsonb,
  cadence text,
  last_story_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int,
         i.brief_length, i.story_count, i.stories_relevant_only, i.evergreen,
         i.search_locale, i.brief_language,
         coalesce((
           select jsonb_agg(jsonb_build_object('date', p.finished_at, 'section_md', p.section_md)
                            order by p.finished_at desc)
           from (
             select r.finished_at, r.section_md from public.runs r
             where r.interest_id = i.id and r.status = 'ready'
             order by r.finished_at desc
             limit 2
           ) p
         ), '[]'::jsonb),
         i.cadence,
         (select max(r.finished_at) from public.runs r
          where r.interest_id = i.id and r.status = 'ready'
            and r.coverage ->> 'status' = 'covered')
  from public.interests i
  where i.id = p_interest
$$;

-- Same claim as 20261121070000_team_runner; the run's facts now come from run_facts.
create or replace function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
returns table (
  run_id uuid,
  topic text,
  doc text,
  searches_per_run integer,
  brief_length text,
  story_count smallint,
  stories_relevant_only boolean,
  evergreen boolean,
  search_locale text,
  brief_language text,
  prior jsonb,
  cadence text,
  last_story_at timestamptz
)
language sql security definer
set search_path = ''
as $$
  with ranked as (
    select r.id, i.owner_id,
           row_number() over (partition by i.owner_id
                              order by r.scheduled_for, r.created_at) as n
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
      and public.is_team_topic(i.owner_id, i.visibility) = p_team
  ), eligible as (
    select ranked.id
    from ranked
    left join public.profiles pr on pr.id = ranked.owner_id
    join public.plans pl on pl.id = coalesce(pr.plan, 'free')
    where coalesce(pr.is_team, false)
       or (public.user_runs_since(ranked.owner_id, p_now - interval '24 hours') + ranked.n
             <= pl.runs_per_day
           and public.user_spend_since(ranked.owner_id, p_now - interval '24 hours')
               + (ranked.n - 1) * 0.10 < pl.spend_per_day_usd)
  ), picked as (
    select r.id
    from public.runs r
    where r.id in (select eligible.id from eligible) and r.status = 'queued'
    order by r.scheduled_for, r.created_at
    limit greatest(p_limit, 0)
    for update skip locked
  ), claimed as (
    update public.runs r
    set status = 'running', started_at = p_now, attempts = r.attempts + 1
    from picked where r.id = picked.id
    returning r.id, r.interest_id
  )
  select c.id, f.*
  from claimed c cross join lateral public.run_facts(c.interest_id) f
$$;

-- The return types change, so drop and create.
drop function public.team_claim_runs(integer, timestamptz);
drop function public.team_start_run(uuid, timestamptz);

-- Claims up to p_limit due Scout team runs, with the same row claim_runs
-- returns. None while the team runner is off or the kill switch is on.
create function public.team_claim_runs(p_limit integer, p_now timestamptz default now())
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.settings where team_runner_on and not paused) then
    return;
  end if;
  perform public.queue_due_runs(p_now, true);
  return query select * from public.claim_queued(p_limit, p_now, true);
end;
$$;

-- A one-off run of one Scout team topic (as 20261121070000_team_runner), with
-- the same row claim_runs returns.
create function public.team_start_run(p_interest uuid, p_now timestamptz default now())
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_run uuid;
begin
  if not exists (select 1 from public.settings where team_runner_on and not paused) then
    raise exception 'team_start_run: the team runner is off' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.interests i
    where i.id = p_interest and public.is_team_topic(i.owner_id, i.visibility)
      and i.deleted_at is null and i.hidden_at is null
  ) then
    raise exception 'team_start_run: no such Scout team topic' using errcode = 'P0002';
  end if;
  insert into public.runs (interest_id, scheduled_for, status, started_at, attempts)
  values (p_interest, p_now, 'running', p_now, 1)
  returning id into v_run;
  return query select v_run, f.* from public.run_facts(p_interest) f;
end;
$$;

revoke execute on function public.run_facts(uuid),
  public.team_claim_runs(integer, timestamptz),
  public.team_start_run(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.team_claim_runs(integer, timestamptz),
  public.team_start_run(uuid, timestamptz)
  to service_role;
