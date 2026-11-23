-- The local account relay (docs/ARCHITECTURE.md, "Local account relay"): a
-- local account (profiles.runs_local) makes no Claude API calls. Its chat
-- turns, publish checks and picks are answered by the Mac's `claude` through
-- the Worker in two steps (the model request, then the Mac's answer).
--
-- - claim_picks (the cron's API picks) never claims a local reader.
-- - team_claim_picks claims the local readers due new picks for the Mac, with
--   no spend gates (their calls cost no API dollars); team_pick_job reloads
--   one such claim when its answer comes back.
-- - publish_relay_start reopens a publish check publish_start opened, for the
--   answer step (no second check, no second count against the limits).

-- One claim loop for both sides: the readers due new picks (the Monday
-- refresh, a profile change at most once per 24 hours, stale picks at most
-- hourly) whose runs_local is p_local. The API side also needs the reader's
-- spending open. Callers hold their own advisory lock.
create function public.claim_due_picks(p_limit integer, p_now timestamptz, p_local boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row record;
  v_run bigint;
  v_kind text;
begin
  for v_row in
    select rp.user_id, rp.weekly_due_at, rp.requested_at
    from public.reader_picks rp
    where ((rp.weekly_due_at is not null
            and (rp.attempted_at is null or rp.attempted_at < rp.weekly_due_at))
        or (rp.requested_at is not null
            and (rp.attempted_at is null or rp.attempted_at <= p_now - interval '24 hours'))
        or (rp.made_at is not null and rp.version < public.picks_version()
            and (rp.attempted_at is null or rp.attempted_at <= p_now - interval '1 hour')))
      and coalesce((select pr.runs_local from public.profiles pr where pr.id = rp.user_id),
                   false) = p_local
      and (p_local or public.user_spending_open(rp.user_id, p_now))
    order by coalesce(rp.weekly_due_at, rp.requested_at, rp.attempted_at), rp.user_id
    limit greatest(least(p_limit, 50), 0)
    for update of rp skip locked
  loop
    v_kind := case when v_row.weekly_due_at is not null then 'weekly'
                   when v_row.requested_at is not null then 'profile'
                   else 'stale' end;
    insert into public.pick_runs (user_id, kind, created_at)
    values (v_row.user_id, v_kind, p_now)
    returning id into v_run;
    update public.reader_picks
    set attempted_at = p_now, requested_at = null
    where user_id = v_row.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', v_row.user_id, 'run_id', v_run, 'kind', v_kind,
      'input', public.picks_input(v_row.user_id)));
  end loop;
  return v_out;
end;
$$;

-- As in 20261121210000_picks_version, but never a local reader (the Mac makes
-- theirs) and the loop is claim_due_picks.
create or replace function public.claim_picks(p_limit integer, p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(hashtext('public.claim_picks')) then
    return '[]'::jsonb;
  end if;

  delete from public.pick_runs where created_at < p_now - interval '30 days';

  -- Every reader, local ones too: a weekly push waits at most 12 hours.
  perform public.flush_weekly_pick(rp.user_id)
  from public.reader_picks rp
  where rp.weekly_due_at < p_now - interval '12 hours';

  if not public.spending_open(p_now) then
    return '[]'::jsonb;
  end if;

  perform public.flush_weekly_pick(rp.user_id)
  from public.reader_picks rp
  where rp.weekly_due_at is not null
    and not coalesce((select pr.runs_local from public.profiles pr where pr.id = rp.user_id), false)
    and not public.user_spending_open(rp.user_id, p_now);

  return public.claim_due_picks(p_limit, p_now, false);
end;
$$;

-- The Mac's picks: the local readers due new picks, as claim_picks's rows.
-- Empty while the team runner is off. No spend gates.
create function public.team_claim_picks(p_limit integer, p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.settings where team_runner_on and not paused) then
    return '[]'::jsonb;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('public.team_claim_picks')) then
    return '[]'::jsonb;
  end if;
  return public.claim_due_picks(p_limit, p_now, true);
end;
$$;

-- One open picks claim of a local reader (not yet finished, made in the last
-- hour), as a claim row with the reader's input now. P0002 otherwise.
create function public.team_pick_job(p_run bigint, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_run public.pick_runs;
begin
  select k.* into v_run from public.pick_runs k
  join public.profiles pr on pr.id = k.user_id
  where k.id = p_run and pr.runs_local
    and k.cost_usd is null and k.error is null
    and k.created_at > p_now - interval '1 hour';
  if not found then
    raise exception 'team_pick_job: no open picks claim for the Mac' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'user_id', v_run.user_id, 'run_id', v_run.id, 'kind', v_run.kind,
    'input', public.picks_input(v_run.user_id));
end;
$$;

-- Service role. The answer step of a relayed publish check: the open check
-- p_check of p_user's (no verdict yet, opened in the last 10 minutes, as
-- publish_finish requires) in publish_start's shape, with the topic as it is
-- now (publish_finish refuses it if it changed). Counts nothing. P0002 otherwise.
create function public.publish_relay_start(p_user uuid, p_check bigint) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
    'checkId', c.id,
    'title', i.topic,
    'doc', i.doc,
    'displayName', pr.display_name,
    'team', coalesce(pr.is_team, false),
    'maxDocChars', pl.max_doc_chars)
  into v_out
  from public.publish_checks c
  join public.interests i on i.id = c.interest_id
  join public.profiles pr on pr.id = c.user_id
  join public.plans pl on pl.id = coalesce(pr.plan, 'free')
  where c.id = p_check and c.user_id = p_user and c.outcome is null
    and c.created_at > now() - interval '10 minutes'
    and i.owner_id = p_user and i.deleted_at is null and i.hidden_at is null;
  if v_out is null then
    raise exception 'publish: no open check' using errcode = 'P0002';
  end if;
  return v_out;
end;
$$;

revoke execute on function public.claim_due_picks(integer, timestamptz, boolean),
  public.team_claim_picks(integer, timestamptz), public.team_pick_job(bigint, timestamptz),
  public.publish_relay_start(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.team_claim_picks(integer, timestamptz),
  public.team_pick_job(bigint, timestamptz), public.publish_relay_start(uuid, bigint)
  to service_role;
