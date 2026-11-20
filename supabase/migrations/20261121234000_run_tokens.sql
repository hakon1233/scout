-- Every hosted run saves its API token usage, so cost can be checked from
-- data. The four columns are the sums over the run's Claude calls (a session
-- with pause_turn continuations, and a retried attempt, make several). Null:
-- no usage was reported (older runs, Scout team runs on the subscription).
--
-- finish_run takes four more optional arguments; everything else is as in
-- 20261121060000_brief_settings. team_finish_run calls it with seven
-- positional arguments, which the new signature still accepts.

alter table public.runs
  add column input_tokens bigint,
  add column output_tokens bigint,
  add column cache_read_tokens bigint,
  add column cache_write_tokens bigint;

drop function public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz, boolean);

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
  p_cache_write_tokens bigint default null
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
  uuid, text, jsonb, integer, numeric, text, timestamptz, boolean, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.finish_run(
  uuid, text, jsonb, integer, numeric, text, timestamptz, boolean, bigint, bigint, bigint, bigint)
  to service_role;
