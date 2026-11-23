-- Exact usage for every run and every Claude call, so cost can be checked
-- from data.
--
-- runs: web fetches, the model that answered, the last stop reason, the
-- number of Claude requests, the largest single prompt in tokens and whether
-- any prompt crossed the 100K long-prompt price line. A Scout team run also
-- records its claude session's tokens and the CLI's own cost estimate in
-- cli_cost_usd, kept apart from cost_usd so it never counts toward the daily
-- API spend ceiling (spend_today). Null: not reported (older runs).
--
-- chat_turns, pick_runs and publish_checks: the input and output tokens of
-- the call, beside the cost they already record.
--
-- Token arguments below 0 count as 0; null (not sent) stays null.
--
-- Each function takes the new values as optional arguments at the end, so a
-- Worker that does not send them yet still works once this is applied. Apply
-- this before deploying the Worker that sends them.

alter table public.runs
  add column web_fetches integer,
  add column model text,
  add column stop_reason text,
  add column requests integer,
  add column max_prompt_tokens bigint,
  add column long_context boolean,
  add column cli_cost_usd numeric(10, 4);

alter table public.chat_turns
  add column input_tokens bigint,
  add column output_tokens bigint;

alter table public.pick_runs
  add column input_tokens bigint,
  add column output_tokens bigint;

alter table public.publish_checks
  add column input_tokens bigint,
  add column output_tokens bigint;

-- ---------------------------------------------------------------------------
-- finish_run: as in 20261121234000_run_tokens, plus the new run columns.
-- Across attempts fetches, requests and the CLI cost add up, the largest
-- prompt and the long-prompt flag stick, and the latest model and stop reason
-- win.
-- ---------------------------------------------------------------------------

drop function public.finish_run(
  uuid, text, jsonb, integer, numeric, text, timestamptz, boolean, bigint, bigint, bigint, bigint);

create function public.finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_searches integer,
  p_cost_usd numeric,
  p_error text default null,
  p_now timestamptz default now(),
  p_retry boolean default true,
  p_input_tokens bigint default null,
  p_output_tokens bigint default null,
  p_cache_read_tokens bigint default null,
  p_cache_write_tokens bigint default null,
  p_web_fetches integer default null,
  p_model text default null,
  p_stop_reason text default null,
  p_requests integer default null,
  p_max_prompt_tokens bigint default null,
  p_long_context boolean default null,
  p_cli_cost_usd numeric default null
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
      input_tokens = case when p_input_tokens is null then input_tokens
        else coalesce(input_tokens, 0) + greatest(p_input_tokens, 0) end,
      output_tokens = case when p_output_tokens is null then output_tokens
        else coalesce(output_tokens, 0) + greatest(p_output_tokens, 0) end,
      cache_read_tokens = case when p_cache_read_tokens is null then cache_read_tokens
        else coalesce(cache_read_tokens, 0) + greatest(p_cache_read_tokens, 0) end,
      cache_write_tokens = case when p_cache_write_tokens is null then cache_write_tokens
        else coalesce(cache_write_tokens, 0) + greatest(p_cache_write_tokens, 0) end,
      web_fetches = case when p_web_fetches is null then web_fetches
        else coalesce(web_fetches, 0) + greatest(p_web_fetches, 0) end,
      model = coalesce(left(p_model, 100), model),
      stop_reason = coalesce(left(p_stop_reason, 100), stop_reason),
      requests = case when p_requests is null then requests
        else coalesce(requests, 0) + greatest(p_requests, 0) end,
      max_prompt_tokens = case when p_max_prompt_tokens is null then max_prompt_tokens
        else greatest(coalesce(max_prompt_tokens, 0), p_max_prompt_tokens) end,
      long_context = case when p_long_context is null then long_context
        else coalesce(long_context, false) or p_long_context end,
      cli_cost_usd = case when p_cli_cost_usd is null then cli_cost_usd
        else coalesce(cli_cost_usd, 0) + greatest(p_cli_cost_usd, 0) end,
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
    if p_coverage ->> 'status' = 'covered' then
      insert into public.outbox (user_id, subscription_id, payload)
      select t.user_id, t.subscription_id,
             jsonb_build_object('run_id', p_run, 'topic', t.topic)
      from public.push_targets(p_run) t;
    end if;
  end if;
  return true;
end;
$$;

revoke execute on function public.finish_run(
  uuid, text, jsonb, integer, numeric, text, timestamptz, boolean, bigint, bigint, bigint, bigint,
  integer, text, text, integer, bigint, boolean, numeric)
  from public, anon, authenticated;
grant execute on function public.finish_run(
  uuid, text, jsonb, integer, numeric, text, timestamptz, boolean, bigint, bigint, bigint, bigint,
  integer, text, text, integer, bigint, boolean, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- team_finish_run: as in 20261121070000_team_runner, plus p_usage, the claude
-- session's usage as the runner reports it (core's CliUsage). Its turns are
-- the run's requests and its cost goes to cli_cost_usd; cost_usd stays 0.
-- ---------------------------------------------------------------------------

drop function public.team_finish_run(uuid, text, jsonb, text, timestamptz);

create function public.team_finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_error text default null,
  p_now timestamptz default now(),
  p_usage jsonb default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  u jsonb := case when jsonb_typeof(p_usage) = 'object' then p_usage end;
begin
  if not exists (
    select 1 from public.runs r join public.interests i on i.id = r.interest_id
    where r.id = p_run and public.is_team_topic(i.owner_id, i.visibility)
  ) then
    raise exception 'team_finish_run: not a Scout team run' using errcode = 'P0002';
  end if;
  return public.finish_run(
    p_run, p_section_md, p_coverage,
    coalesce((u ->> 'webSearches')::integer, 0), 0, p_error, p_now, true,
    (u ->> 'inputTokens')::bigint, (u ->> 'outputTokens')::bigint,
    (u ->> 'cacheReadTokens')::bigint, (u ->> 'cacheWriteTokens')::bigint,
    p_web_fetches => (u ->> 'webFetches')::integer,
    p_model => u ->> 'model',
    p_stop_reason => u ->> 'stopReason',
    p_requests => (u ->> 'turns')::integer,
    p_cli_cost_usd => (u ->> 'costUsd')::numeric);
end;
$$;

revoke execute on function public.team_finish_run(uuid, text, jsonb, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.team_finish_run(uuid, text, jsonb, text, timestamptz, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- commit_chat_turn: as in 20261121010000_limits, plus the turn's tokens.
-- ---------------------------------------------------------------------------

drop function public.commit_chat_turn(uuid, jsonb, uuid[], numeric);

create function public.commit_chat_turn(
  p_user uuid, p_turn jsonb, p_follows uuid[], p_cost_usd numeric,
  p_input_tokens bigint default null, p_output_tokens bigint default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_change jsonb;
begin
  for v_change in select * from jsonb_array_elements(coalesce(p_turn -> 'changes', '[]'))
  loop
    case v_change ->> 'op'
      when 'create' then
        insert into public.interests (id, owner_id, topic, doc)
        values ((v_change ->> 'interestId')::uuid, p_user,
                v_change ->> 'topic', coalesce(v_change ->> 'doc', ''));
      when 'update' then
        update public.interests
        set topic = coalesce(v_change ->> 'topic', topic),
            doc = coalesce(v_change ->> 'doc', doc)
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      when 'delete' then
        update public.interests set deleted_at = now()
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      else
        raise exception 'commit_chat_turn: unknown op %', v_change ->> 'op';
    end case;
  end loop;

  insert into public.follows (user_id, interest_id)
  select p_user, i.id from public.interests i
  where i.id = any(coalesce(p_follows, '{}')) and i.visibility = 'public'
    and public.interest_is_listed(i) and i.owner_id <> p_user
  on conflict do nothing;

  insert into public.chat_turns as t
    (id, user_id, message, reply, changes, pending, status, cost_usd, error_msg, created_at,
     input_tokens, output_tokens)
  values (
    (p_turn ->> 'id')::uuid, p_user, p_turn ->> 'message', p_turn ->> 'reply',
    nullif(p_turn -> 'changes', 'null'::jsonb), nullif(p_turn -> 'pending', 'null'::jsonb),
    p_turn ->> 'status', greatest(coalesce(p_cost_usd, 0), 0), p_turn ->> 'error_msg',
    coalesce((p_turn ->> 'created_at')::timestamptz, now()),
    case when p_input_tokens < 0 then 0 else p_input_tokens end,
    case when p_output_tokens < 0 then 0 else p_output_tokens end)
  on conflict (id) do update
    set message = excluded.message, reply = excluded.reply, changes = excluded.changes,
        pending = excluded.pending, status = excluded.status, cost_usd = excluded.cost_usd,
        error_msg = excluded.error_msg, input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens
    where t.user_id = excluded.user_id and t.status = 'pending';
  if not found then
    raise exception 'commit_chat_turn: turn % is not this reader''s pending turn',
      p_turn ->> 'id' using errcode = '23505';
  end if;
end;
$$;

revoke execute on function public.commit_chat_turn(uuid, jsonb, uuid[], numeric, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.commit_chat_turn(uuid, jsonb, uuid[], numeric, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- finish_picks: as in 20261121210000_picks_version, plus the call's tokens.
-- ---------------------------------------------------------------------------

drop function public.finish_picks(uuid, bigint, jsonb, numeric, text, integer);

create function public.finish_picks(
  p_user uuid, p_run bigint, p_picks jsonb, p_cost numeric, p_error text default null,
  p_version integer default 0,
  p_input_tokens bigint default null, p_output_tokens bigint default null
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_picks jsonb;
  v_n integer := 0;
begin
  update public.pick_runs
  set cost_usd = greatest(coalesce(p_cost, 0), 0), error = left(p_error, 500),
      input_tokens = case when p_input_tokens < 0 then 0 else p_input_tokens end,
      output_tokens = case when p_output_tokens < 0 then 0 else p_output_tokens end
  where id = p_run and user_id = p_user;

  if p_picks is not null and jsonb_typeof(p_picks) = 'array' then
    with given as (
      select (x.value ->> 'interest_id')::uuid as id,
             left(btrim(coalesce(x.value ->> 'reason', '')), 140) as reason,
             x.ord
      from jsonb_array_elements(p_picks) with ordinality x(value, ord)
      where jsonb_typeof(x.value) = 'object'
        and x.value ->> 'interest_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and x.ord <= 50
    ), first_of_each as (
      select distinct on (g.id) g.id, g.reason, g.ord
      from given g
      where public.pickable(p_user, g.id)
      order by g.id, g.ord
    ), kept as (
      select * from first_of_each order by ord limit 5
    )
    select coalesce(jsonb_agg(jsonb_build_object('interest_id', k.id, 'reason', k.reason)
                              order by k.ord), '[]'::jsonb), count(*)
    into v_picks, v_n
    from kept k;

    insert into public.reader_picks (user_id, picks, made_at, version)
    values (p_user, v_picks, now(), coalesce(p_version, 0))
    on conflict (user_id) do update
      set picks = excluded.picks, made_at = excluded.made_at, version = excluded.version;
  end if;

  perform public.flush_weekly_pick(p_user);
  return v_n;
end;
$$;

revoke execute on function public.finish_picks(uuid, bigint, jsonb, numeric, text, integer, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.finish_picks(uuid, bigint, jsonb, numeric, text, integer, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- publish_finish: as in 20261121100000_publish, plus the call's tokens.
-- ---------------------------------------------------------------------------

drop function public.publish_finish(uuid, bigint, boolean, text[], text, numeric);

create function public.publish_finish(
  p_user uuid, p_check bigint, p_approved boolean, p_tags text[], p_reason text,
  p_cost_usd numeric default 0,
  p_input_tokens bigint default null, p_output_tokens bigint default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c public.publish_checks;
  v_tags text[];
  v_slug text;
begin
  perform pg_advisory_xact_lock(hashtext('publish:' || p_user::text));

  select * into v_c from public.publish_checks
  where id = p_check and user_id = p_user and outcome is null
    and created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'publish: no open check' using errcode = 'P0002';
  end if;

  if not p_approved then
    update public.publish_checks
    set outcome = 'refused', reason = left(coalesce(p_reason, ''), 300), finished_at = now(),
        cost_usd = greatest(coalesce(p_cost_usd, 0), 0),
        input_tokens = case when p_input_tokens < 0 then 0 else p_input_tokens end,
      output_tokens = case when p_output_tokens < 0 then 0 else p_output_tokens end
    where id = p_check;
    return null;
  end if;

  v_tags := public.normalize_tags(p_tags);
  if cardinality(v_tags) = 0 then
    raise exception 'publish: an approved topic needs a tag' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.interests
    where id = v_c.interest_id and public.text_hash(topic, doc) = v_c.text_hash) then
    raise exception 'publish: the topic changed during its check'
      using errcode = '40001', hint = 'changed';
  end if;

  update public.interests set tags = v_tags where id = v_c.interest_id;
  v_slug := public.set_visibility(p_user, v_c.interest_id, 'public');
  update public.interests set published_at = now() where id = v_c.interest_id;
  update public.publish_checks
  set outcome = 'approved', tags = v_tags, finished_at = now(),
      cost_usd = greatest(coalesce(p_cost_usd, 0), 0),
      input_tokens = case when p_input_tokens < 0 then 0 else p_input_tokens end,
      output_tokens = case when p_output_tokens < 0 then 0 else p_output_tokens end
  where id = p_check;
  return v_slug;
end;
$$;

revoke execute on function public.publish_finish(uuid, bigint, boolean, text[], text, numeric, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.publish_finish(uuid, bigint, boolean, text[], text, numeric, bigint, bigint)
  to service_role;
