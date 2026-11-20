-- Per-interest brief settings, the last briefs a run should not repeat, and
-- failures that are not retried.
--
-- Settings (packages/core/src/brief-settings.ts reads and checks the same
-- values): how long a section reads, how many stories it carries, whether
-- older background is welcome, where to search and what language to write in.
-- Owners change them like the cadence: a column update through RLS.
--
-- claim_runs now also hands the Worker each claimed interest's settings and
-- its last two ready sections, so the prompt can say "already reported".
-- finish_run takes p_retry: false when a second attempt cannot help (a 4xx,
-- a rate or spend limit, a timeout), so the run fails at once.

alter table public.interests
  add column brief_length text not null default 'normal'
    check (brief_length in ('short', 'normal', 'long')),
  add column story_count smallint not null default 4
    check (story_count between 1 and 4),
  add column stories_relevant_only boolean not null default false,
  add column evergreen boolean not null default false,
  -- BCP 47 language tag with an optional region: 'nb-NO', 'de'.
  add column search_locale text
    check (search_locale is null or search_locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  -- ISO 639 language code: 'en', 'nb'. Null: the intent doc's language.
  add column brief_language text
    check (brief_language is null or brief_language ~ '^[a-z]{2,3}$');

grant insert (brief_length, story_count, stories_relevant_only, evergreen,
              search_locale, brief_language) on public.interests to authenticated;
grant update (brief_length, story_count, stories_relevant_only, evergreen,
              search_locale, brief_language) on public.interests to authenticated;

-- ---------------------------------------------------------------------------
-- Failing an attempt: at most one retry, none when p_retry is false
-- ---------------------------------------------------------------------------

drop function public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz);
drop function public.claim_runs(integer, timestamptz);
drop function public.fail_run_attempt(uuid, text, timestamptz);

create function public.fail_run_attempt(
  p_run uuid,
  p_error text,
  p_now timestamptz,
  p_retry boolean default true
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_run public.runs;
begin
  update public.runs r set
    status = case when r.attempts < 2 and p_retry then 'queued' else 'failed' end,
    error_msg = left(p_error, 1000),
    finished_at = case when r.attempts < 2 and p_retry then null else p_now end
  where r.id = p_run and r.status = 'running'
  returning * into v_run;

  if v_run.status = 'failed' then
    insert into public.notifications (user_id, kind, payload)
    select i.owner_id, 'run_failed',
           jsonb_build_object('interest_id', i.id, 'topic', i.topic,
                              'run_id', v_run.id, 'error', v_run.error_msg)
    from public.interests i where i.id = v_run.interest_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_runs: as before, plus settings and the last two sections
-- ---------------------------------------------------------------------------

create function public.claim_runs(p_limit integer, p_now timestamptz default now())
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

  update public.runs r set status = 'failed', error_msg = 'interest deleted', finished_at = p_now
  from public.interests i
  where i.id = r.interest_id and r.status = 'queued' and i.deleted_at is not null;

  if not public.spending_open(p_now) then
    return;
  end if;

  insert into public.runs (interest_id, scheduled_for)
  select i.id, s.slot
  from public.interests i
  left join public.profiles pr on pr.id = i.owner_id
  cross join lateral (
    select public.last_run_slot(i.cadence, i.run_at, i.run_weekday,
                                coalesce(pr.timezone, 'UTC'), p_now) as slot
  ) s
  where i.cadence in ('daily', 'weekly') and i.deleted_at is null
    and s.slot >= i.created_at
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null and r.scheduled_for >= s.slot)
  on conflict (interest_id) where status in ('queued', 'running') do nothing;

  return query
  with picked as (
    select r.id
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
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
  from claimed c join public.interests i on i.id = c.interest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_run: as before, plus p_retry
-- ---------------------------------------------------------------------------

create function public.finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_searches integer,
  p_cost_usd numeric,
  p_error text default null,
  p_now timestamptz default now(),
  p_retry boolean default true
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_running boolean;
begin
  update public.runs
  set cost_usd = coalesce(cost_usd, 0) + greatest(coalesce(p_cost_usd, 0), 0),
      searches = coalesce(searches, 0) + greatest(coalesce(p_searches, 0), 0),
      coverage = coalesce(p_coverage, coverage)
  where id = p_run
  returning status = 'running' into v_running;

  if not coalesce(v_running, false) then
    return false;
  end if;

  if p_section_md is null then
    perform public.fail_run_attempt(p_run, coalesce(p_error, 'no section'), p_now, p_retry);
  else
    update public.runs
    set status = 'ready', section_md = p_section_md, error_msg = null, finished_at = p_now
    where id = p_run;
  end if;
  return true;
end;
$$;

revoke execute on function public.fail_run_attempt(uuid, text, timestamptz, boolean),
  public.claim_runs(integer, timestamptz),
  public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_runs(integer, timestamptz),
  public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz, boolean)
  to service_role;
