-- The Scout team runner and hiding public topics.
--
-- The Scout team is the catalog account that owns the public starter topics
-- (seeds/public-interests.sql). Its public topics never run on the Worker's API
-- calls: claim_runs always skips them. They run only on Håkon's own machine
-- (the local `claude` CLI, `pnpm team:run`), and only while
-- settings.team_runner_on is set; while it is off they do not run at all.
-- The local runner never holds a Supabase key. It calls the Worker's /team routes with TEAM_RUNNER_TOKEN, and
-- the Worker calls the team_* functions below, which only touch the Scout
-- team's public topics. Off by default.
--
-- Hiding: a public topic found unfit (Harness Copilot's "Public topic check")
-- is hidden, never deleted: hidden_at and hidden_reason are set, a row lands in
-- moderation_log, and no one but its owner can read it or follow it. Its runs
-- stop. Undo by hand (as postgres):
--   update public.interests set hidden_at = null, hidden_reason = null where id = '<id>';

alter table public.settings
  add column team_runner_on boolean not null default false,
  -- The catalog account (seeds/public-interests.sql).
  add column team_owner uuid default '5c0a7000-0000-4000-8000-000000000001';

alter table public.interests
  -- A paused interest keeps its cadence but never gets a scheduled run, on the
  -- Worker or the team runner. The Scout team's test topics are seeded paused
  -- (seeds/team-topics.sql): they run only as one-offs (`pnpm team:run --only`).
  add column paused boolean not null default false,
  add column hidden_at timestamptz,
  add column hidden_reason text check (char_length(hidden_reason) <= 500);

create table public.moderation_log (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid not null references public.interests (id) on delete cascade,
  action text not null check (action in ('hide')),
  reason text not null,
  -- Who asked: 'moderation-token' for the Worker's /team/hide.
  actor text not null,
  created_at timestamptz not null default now()
);

alter table public.moderation_log enable row level security;
grant select on public.moderation_log to service_role;

-- ---------------------------------------------------------------------------
-- Hidden topics: no one but the owner reads or follows them
-- ---------------------------------------------------------------------------

drop policy interests_public_read on public.interests;
create policy interests_public_read on public.interests
  for select to anon, authenticated
  using (visibility = 'public' and deleted_at is null and hidden_at is null);

create or replace function public.follow(p_slug text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.interests;
begin
  if auth.uid() is null then
    raise exception 'follow: sign in first' using errcode = '42501';
  end if;
  select * into v_row from public.interests
  where share_slug = p_slug and visibility in ('shared', 'public')
    and deleted_at is null and hidden_at is null;
  if not found then
    raise exception 'follow: no such shared interest' using errcode = 'P0002';
  end if;
  if v_row.owner_id <> auth.uid() then
    insert into public.follows (user_id, interest_id)
    values (auth.uid(), v_row.id)
    on conflict do nothing;
  end if;
  return v_row.id;
end;
$$;

create or replace function public.interest_by_slug(p_slug text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'topic', i.topic,
    'visibility', i.visibility,
    'owned', i.owner_id = auth.uid(),
    'following', exists (
      select 1 from public.follows f
      where f.interest_id = i.id and f.user_id = auth.uid()),
    'run', (
      select jsonb_build_object('id', r.id, 'section_md', r.section_md,
                                'coverage', r.coverage, 'finished_at', r.finished_at)
      from public.runs r
      where r.interest_id = i.id and r.status = 'ready'
      order by r.finished_at desc nulls last
      limit 1))
  from public.interests i
  where i.share_slug = p_slug and i.visibility in ('shared', 'public')
    and i.deleted_at is null and i.hidden_at is null
$$;

-- ---------------------------------------------------------------------------
-- Who runs an interest
-- ---------------------------------------------------------------------------

-- A Scout team topic: a public interest of the catalog account.
create function public.is_team_topic(p_owner uuid, p_visibility text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_visibility = 'public' and p_owner = s.team_owner from public.settings s
$$;

-- ---------------------------------------------------------------------------
-- The queue, split so the Worker and the team runner share it
-- ---------------------------------------------------------------------------

-- Live, unhidden, unpaused scheduled interests whose latest slot has no
-- scheduled run yet.
create function public.due_interests(p_now timestamptz)
returns table (interest_id uuid, slot timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select i.id, s.slot
  from public.interests i
  left join public.profiles pr on pr.id = i.owner_id
  cross join lateral (
    select public.last_run_slot(i.cadence, i.run_at, i.run_weekday,
                                coalesce(pr.timezone, 'UTC'), p_now) as slot
  ) s
  where i.cadence in ('daily', 'weekly') and i.deleted_at is null
    and i.hidden_at is null and not i.paused
    and s.slot >= i.created_at
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null and r.scheduled_for >= s.slot)
$$;

-- Queues every due interest of one runner (single flight: one queued or
-- running run per interest).
create function public.queue_due_runs(p_now timestamptz, p_team boolean)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.runs (interest_id, scheduled_for)
  select d.interest_id, d.slot
  from public.due_interests(p_now) d
  join public.interests i on i.id = d.interest_id
  where public.is_team_topic(i.owner_id, i.visibility) = p_team
  on conflict (interest_id) where status in ('queued', 'running') do nothing
$$;

-- Claims up to p_limit queued runs of one runner, public interests first, then
-- oldest, skipping rows another tick holds. Each claimed run is marked running.
create function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
returns table (run_id uuid, topic text, doc text, searches_per_run integer)
language sql security definer
set search_path = ''
as $$
  with picked as (
    select r.id
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
      and public.is_team_topic(i.owner_id, i.visibility) = p_team
    order by (i.visibility = 'public') desc, r.scheduled_for, r.created_at
    limit greatest(p_limit, 0)
    for update of r skip locked
  ), claimed as (
    update public.runs r
    set status = 'running', started_at = p_now, attempts = r.attempts + 1
    from picked where r.id = picked.id
    returning r.id, r.interest_id
  )
  select c.id, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int
  from claimed c join public.interests i on i.id = c.interest_id
$$;

-- The Worker's tick, as before, minus the Scout team's public topics (always):
--   1. reap: running runs older than 10 minutes fail an attempt; queued runs
--      of deleted or hidden interests fail;
--   2. stop when the kill switch is on or today's spend is at the ceiling;
--   3. queue and 4. claim the Worker's due runs.
create or replace function public.claim_runs(p_limit integer, p_now timestamptz default now())
returns table (run_id uuid, topic text, doc text, searches_per_run integer)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_stale uuid;
begin
  for v_stale in
    select r.id from public.runs r
    where r.status = 'running' and r.started_at < p_now - interval '10 minutes'
    for update skip locked
  loop
    perform public.fail_run_attempt(v_stale, 'the run stopped without a result', p_now);
  end loop;

  update public.runs r
  set status = 'failed', finished_at = p_now,
      error_msg = case when i.deleted_at is not null then 'interest deleted'
                       else 'interest hidden' end
  from public.interests i
  where i.id = r.interest_id and r.status = 'queued'
    and (i.deleted_at is not null or i.hidden_at is not null);

  if not public.spending_open(p_now) then
    return;
  end if;

  perform public.queue_due_runs(p_now, false);
  return query select * from public.claim_queued(p_limit, p_now, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The team runner's functions (service role, through the Worker's /team routes)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit due Scout team runs. None while the team runner is off
-- or the kill switch is on. The Worker's 10-minute reaper also covers these
-- runs, so the runner claims one at a time.
create function public.team_claim_runs(p_limit integer, p_now timestamptz default now())
returns table (run_id uuid, topic text, doc text, searches_per_run integer)
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

-- Every live Scout team topic, and whether it is due now (its slot has no run
-- yet, or a run waits in the queue). Read only: the runner's --dry-run and
-- --only use it. Works with the runner off.
create function public.team_topics(p_now timestamptz default now())
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
  where public.is_team_topic(i.owner_id, i.visibility)
    and i.deleted_at is null and i.hidden_at is null
  order by i.topic
$$;

-- A one-off run of one Scout team topic, paused or not, whatever its cadence.
-- It leaves the topic as it was, so a paused test topic stays paused. The run starts as running, so
-- the Worker never sees it queued. Needs the team runner on. Fails with 23505
-- when the topic already has a queued or running run.
create function public.team_start_run(p_interest uuid, p_now timestamptz default now())
returns table (run_id uuid, topic text, doc text, searches_per_run integer)
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
  return query
  select v_run, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int
  from public.interests i where i.id = p_interest;
end;
$$;

-- Records a claimed Scout team run's result through finish_run, so readers get
-- it exactly as they get any run. The research cost no API dollars. Refuses a
-- run that is not a Scout team topic's.
create function public.team_finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_error text default null,
  p_now timestamptz default now()
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.runs r join public.interests i on i.id = r.interest_id
    where r.id = p_run and public.is_team_topic(i.owner_id, i.visibility)
  ) then
    raise exception 'team_finish_run: not a Scout team run' using errcode = 'P0002';
  end if;
  return public.finish_run(p_run, p_section_md, p_coverage, 0, 0, p_error, p_now);
end;
$$;

-- Hides a public topic and logs why. Returns false when it was already hidden.
create function public.team_hide_interest(p_interest uuid, p_reason text, p_actor text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'team_hide_interest: give a reason' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.interests
    where id = p_interest and visibility = 'public' and deleted_at is null
  ) then
    raise exception 'team_hide_interest: no such public topic' using errcode = 'P0002';
  end if;
  update public.interests
  set hidden_at = now(), hidden_reason = left(btrim(p_reason), 500)
  where id = p_interest and hidden_at is null;
  if not found then
    return false;
  end if;
  insert into public.moderation_log (interest_id, action, reason, actor)
  values (p_interest, 'hide', left(btrim(p_reason), 500), p_actor);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.is_team_topic(uuid, text),
  public.due_interests(timestamptz),
  public.queue_due_runs(timestamptz, boolean),
  public.claim_queued(integer, timestamptz, boolean),
  public.team_claim_runs(integer, timestamptz), public.team_topics(timestamptz),
  public.team_start_run(uuid, timestamptz),
  public.team_finish_run(uuid, text, jsonb, text, timestamptz),
  public.team_hide_interest(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.team_claim_runs(integer, timestamptz),
  public.team_topics(timestamptz), public.team_start_run(uuid, timestamptz),
  public.team_finish_run(uuid, text, jsonb, text, timestamptz),
  public.team_hide_interest(uuid, text, text)
  to service_role;
