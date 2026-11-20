-- The Scout team runner and the moderation log.
--
-- The Scout team is the catalog account (profiles.is_team, 20261121000000_listing)
-- that owns the public starter topics (seeds/public-interests.sql). Its public
-- topics never run on the Worker's API calls: claim_runs always skips them.
-- They run only on Håkon's own machine (the local `claude` CLI, `pnpm
-- team:run`), and only while settings.team_runner_on is set; while it is off
-- they do not run at all. The local runner never holds a Supabase key. It
-- calls the Worker's /team routes with TEAM_RUNNER_TOKEN, and the Worker calls
-- the team_* functions below, which only touch the Scout team's public topics.
-- Off by default.
--
-- Hiding (Harness Copilot's "Public topic check") goes through hide_interest
-- (20261121000000_listing) and is logged in moderation_log. Undo by hand (as
-- postgres):
--   update public.interests set hidden_at = null, hidden_reason = null where id = '<id>';

alter table public.settings add column team_runner_on boolean not null default false;

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
-- Who runs an interest
-- ---------------------------------------------------------------------------

-- A Scout team topic: a public interest of a team account.
create function public.is_team_topic(p_owner uuid, p_visibility text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_visibility = 'public'
     and coalesce((select pr.is_team from public.profiles pr where pr.id = p_owner), false)
$$;

-- The catalog holds more topics than any plan allows: team accounts skip the
-- interest caps of 20261121010000_limits (they already skipped the public cap).
create or replace function public.check_interest_allowance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
  v_same boolean;
  v_live boolean;
  v_live_before boolean;
begin
  -- Serialise quota checks per owner so two inserts cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('interest-quota:' || new.owner_id::text));
  v_allow := public.allowance(new.owner_id);

  if tg_op = 'INSERT' or new.doc is distinct from old.doc then
    if char_length(new.doc) > (v_allow -> 'limits' ->> 'max_doc_chars')::int then
      raise exception 'quota: intent doc is longer than % characters',
        v_allow -> 'limits' ->> 'max_doc_chars'
        using errcode = 'P0001', hint = 'max_doc_chars';
    end if;
  end if;

  -- Team accounts (the Scout team's catalog, seeds/team-topics.sql) have no
  -- interest caps; the doc cap above still holds.
  if coalesce((select is_team from public.profiles where id = new.owner_id), false) then
    return new;
  end if;

  -- Each cap is checked only when the row starts to count, so lowering a limit
  -- never blocks unrelated edits. allowance() counts the stored rows; this row
  -- is not among them for what it is about to become.
  v_same := tg_op = 'UPDATE' and old.owner_id = new.owner_id;
  v_live := new.deleted_at is null;
  v_live_before := v_same and old.deleted_at is null;

  if v_live and not v_live_before
     and (v_allow -> 'used' ->> 'interests')::int
         >= (v_allow -> 'limits' ->> 'max_interests')::int then
    raise exception 'quota: % of % interests used',
      v_allow -> 'used' ->> 'interests', v_allow -> 'limits' ->> 'max_interests'
      using errcode = 'P0001', hint = 'max_interests';
  end if;

  if v_live and new.cadence in ('daily', 'weekly')
     and not (v_live_before and old.cadence = new.cadence)
     and (v_allow -> 'used' ->> (new.cadence || '_interests'))::int
         >= (v_allow -> 'limits' ->> (new.cadence || '_interests'))::int then
    raise exception 'quota: % of % % interests used',
      v_allow -> 'used' ->> (new.cadence || '_interests'),
      v_allow -> 'limits' ->> (new.cadence || '_interests'),
      new.cadence
      using errcode = 'P0001', hint = new.cadence || '_interests';
  end if;

  if v_live and new.visibility = 'public'
     and not (v_live_before and old.visibility = 'public')
     and (v_allow -> 'used' ->> 'public_interests')::int
         >= (v_allow -> 'limits' ->> 'max_public_interests')::int then
    raise exception 'quota: % of % public interests used',
      v_allow -> 'used' ->> 'public_interests', v_allow -> 'limits' ->> 'max_public_interests'
      using errcode = 'P0001', hint = 'max_public_interests';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The queue, split so the Worker and the team runner share it
-- ---------------------------------------------------------------------------

-- Live, unhidden, unpaused scheduled interests whose latest slot is due: no
-- scheduled run in the 20 hours (daily) or 6 days (weekly) before it.
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
      where r.interest_id = i.id and r.requested_by is null
        and r.scheduled_for > s.slot - case i.cadence when 'daily' then interval '20 hours'
                                                      else interval '6 days' end)
$$;

-- Queues every due interest of one runner (single flight: one queued or
-- running run per interest).
create function public.queue_due_runs(p_now timestamptz, p_team boolean)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.runs (interest_id, scheduled_for, created_at)
  select d.interest_id, d.slot, p_now
  from public.due_interests(p_now) d
  join public.interests i on i.id = d.interest_id
  where public.is_team_topic(i.owner_id, i.visibility) = p_team
  on conflict (interest_id) where status in ('queued', 'running') do nothing
$$;

-- Claims up to p_limit queued runs of one runner, oldest first (public gets no
-- priority), skipping owners at their runs_per_day or spend cap (team accounts
-- skip both) and rows another tick holds. Each claimed run is marked running
-- and comes with its interest's brief settings, its last two ready sections,
-- its cadence and when it last had a story.
create function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
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
  -- [{ "date": finished_at, "section_md": … }], newest first, at most two.
  prior jsonb,
  cadence text,
  -- When the last ready run with a story (coverage 'covered') finished.
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
  select c.id, i.topic, i.doc,
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
  from claimed c join public.interests i on i.id = c.interest_id
$$;

-- The Worker's tick (the one definition; earlier migrations hold its history):
--   1. reap: running runs older than 10 minutes fail an attempt; queued runs
--      of deleted or hidden interests fail;
--   2. stop when the kill switch is on or the global 24-hour spend is at the
--      ceiling;
--   3. queue and 4. claim the Worker's due runs (claim_queued), never the
--      Scout team's public topics.
create or replace function public.claim_runs(p_limit integer, p_now timestamptz default now())
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
  return query select q.run_id, q.topic, q.doc, q.searches_per_run
               from public.claim_queued(p_limit, p_now, true) q;
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

-- Hides a public topic through hide_interest and logs why. Returns false when
-- it was already hidden.
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
  if exists (select 1 from public.interests where id = p_interest and hidden_at is not null) then
    return false;
  end if;
  perform public.hide_interest(p_interest, p_reason);
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
