-- The catalog switch: settings.team_catalog_on, off by default. The Scout team
-- runner (the Mac) does local accounts' topics (profiles.runs_local) while
-- settings.team_runner_on is set; the Scout team's public topics (the catalog)
-- run only while team_catalog_on is set too. The database decides, so a runner
-- started by mistake cannot spend on the catalog. While it is off, catalog
-- topics are not queued, a queued catalog Run now fails at the next team claim,
-- team_topics leaves them out and team_start_run refuses one. The Worker's
-- claim_runs never takes them either way (runs_on_mac is unchanged).
--
-- Switch on (as postgres):
--   update public.settings set team_catalog_on = true;

alter table public.settings add column team_catalog_on boolean not null default false;

-- Whether the Mac may run this topic now: any topic of a local account, or a
-- Scout team public topic while the catalog is on. Implies runs_on_mac.
create function public.mac_runs_now(p_owner uuid, p_visibility text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select pr.runs_local
                          or (pr.is_team and p_visibility = 'public'
                              and exists (select 1 from public.settings where team_catalog_on))
                   from public.profiles pr where pr.id = p_owner), false)
$$;

revoke execute on function public.mac_runs_now(uuid, text) from public, anon, authenticated;

-- As in 20261123020000_runs_local; the Mac's side queues only what it may run now.
create or replace function public.queue_due_runs(p_now timestamptz, p_team boolean)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.runs (interest_id, scheduled_for, created_at)
  select d.interest_id, d.slot, p_now
  from public.due_interests(p_now) d
  join public.interests i on i.id = d.interest_id
  where case when p_team then public.mac_runs_now(i.owner_id, i.visibility)
             else not public.runs_on_mac(i.owner_id, i.visibility) end
  on conflict (interest_id) where status in ('queued', 'running') do nothing
$$;

-- As in 20261123020000_runs_local; the Mac's side claims only what it may run now.
create or replace function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz,
  mode text, sent_keys text[]
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
      and case when p_team then public.mac_runs_now(i.owner_id, i.visibility)
               else not public.runs_on_mac(i.owner_id, i.visibility) end
      and (i.mode = 'news' or exists (select 1 from public.settings where make_on))
  ), eligible as (
    select ranked.id
    from ranked
    left join public.profiles pr on pr.id = ranked.owner_id
    join public.plans pl on pl.id = coalesce(pr.plan, 'free')
    where coalesce(pr.is_team, false) or coalesce(pr.runs_local, false)
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

-- As in 20261123010000_make_mode; while the catalog is off, a queued catalog
-- run (a Run now) fails rather than waiting.
create or replace function public.team_claim_runs(p_limit integer, p_now timestamptz default now())
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz,
  mode text, sent_keys text[]
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.settings where team_runner_on and not paused) then
    return;
  end if;
  update public.runs r
  set status = 'failed', finished_at = p_now, error_msg = 'the Scout team catalog is off'
  from public.interests i
  where i.id = r.interest_id and r.status = 'queued'
    and public.runs_on_mac(i.owner_id, i.visibility)
    and not public.mac_runs_now(i.owner_id, i.visibility);
  perform public.queue_due_runs(p_now, true);
  return query select * from public.claim_queued(p_limit, p_now, true);
end;
$$;

-- As in 20261123020000_runs_local, with mac_runs_now.
create or replace function public.team_topics(p_now timestamptz default now())
returns table (interest_id uuid, topic text, doc text, searches_per_run integer, due boolean)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int,
         i.id in (select d.interest_id from public.due_interests(p_now) d)
           or exists (select 1 from public.runs r
                      where r.interest_id = i.id and r.status = 'queued'
                        and r.scheduled_for <= p_now)
  from public.interests i
  where public.mac_runs_now(i.owner_id, i.visibility)
    and i.deleted_at is null and i.hidden_at is null
  order by i.topic
$$;

-- As in 20261123020000_runs_local; a catalog topic only while the catalog is on.
create or replace function public.team_start_run(p_interest uuid, p_now timestamptz default now())
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz,
  mode text, sent_keys text[]
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
    where i.id = p_interest and public.runs_on_mac(i.owner_id, i.visibility)
      and i.deleted_at is null and i.hidden_at is null
  ) then
    raise exception 'team_start_run: no such topic for the Mac' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.interests i
    where i.id = p_interest and public.mac_runs_now(i.owner_id, i.visibility)
  ) then
    raise exception 'team_start_run: the Scout team catalog is off' using errcode = '55000';
  end if;
  if exists (select 1 from public.interests i where i.id = p_interest and i.mode = 'make')
     and not exists (select 1 from public.settings where make_on) then
    raise exception 'team_start_run: make mode is off' using errcode = '55000';
  end if;
  insert into public.runs (interest_id, scheduled_for, status, started_at, attempts)
  values (p_interest, p_now, 'running', p_now, 1)
  returning id into v_run;
  return query select v_run, f.* from public.run_facts(p_interest) f;
end;
$$;
