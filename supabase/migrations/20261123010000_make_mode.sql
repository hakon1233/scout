-- Make mode: a topic Scout writes itself (a bedtime story, a word of the day)
-- instead of researching news. No web tools, so no search fee.
--
-- interests.mode is 'news' (today's behaviour) or 'make'. The setup chat sets
-- it; readers cannot write it directly (column grants stay as they are).
-- interests.sent_keys is the topic's "already sent" memory: the one-line key
-- (the story bullet's title) of its last 60 pieces, oldest first. The runs
-- table is cleaned after 30 days, so the memory lives on the interest.
--
-- settings.make_on is the switch, off by default. While it is off, make topics
-- are never queued or claimed, and a queued make run (a "Run now") fails.

alter table public.settings add column make_on boolean not null default false;

alter table public.interests
  add column mode text not null default 'news' check (mode in ('news', 'make')),
  add column sent_keys text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- The "already sent" memory: a make run that lands adds its piece's key.
-- ---------------------------------------------------------------------------

-- The key of a make section: its first story bullet's text after the date
-- marker, with markdown emphasis taken out. null when there is none.
create function public.make_piece_key(p_section_md text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    substring(p_section_md from '(?n)^- `[^`]+`\s*[—–-]\s*(.+)$'),
    '[*_`]', '', 'g')), '')
$$;

create function public.remember_make_piece()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text := public.make_piece_key(new.section_md);
begin
  if v_key is null then
    return null;
  end if;
  update public.interests i
  set sent_keys = (select coalesce(array_agg(k order by n), '{}')
                   from unnest(i.sent_keys || v_key) with ordinality u(k, n)
                   where n > cardinality(i.sent_keys) + 1 - 60)
  where i.id = new.interest_id and i.mode = 'make';
  return null;
end;
$$;

create trigger runs_remember_make_piece
after update of status on public.runs
for each row
when (new.status = 'ready' and old.status is distinct from 'ready')
execute function public.remember_make_piece();

revoke execute on function public.make_piece_key(text), public.remember_make_piece()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling: make topics only while make_on.
-- ---------------------------------------------------------------------------

-- As in 20261121210100_first_brief, minus make topics while make mode is off.
create or replace function public.due_interests(p_now timestamptz)
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
    and (i.mode = 'news' or exists (select 1 from public.settings where make_on))
    and (s.slot >= i.created_at
         or not exists (select 1 from public.runs r0 where r0.interest_id = i.id))
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null
        and r.scheduled_for > s.slot - case i.cadence when 'daily' then interval '20 hours'
                                                      else interval '6 days' end)
$$;

-- ---------------------------------------------------------------------------
-- A run's facts gain the mode and the "already sent" list. The return types
-- change, so every function returning run_facts' row is dropped and created.
-- ---------------------------------------------------------------------------

drop function public.team_claim_runs(integer, timestamptz);
drop function public.team_start_run(uuid, timestamptz);
drop function public.claim_runs(integer, timestamptz);
drop function public.claim_queued(integer, timestamptz, boolean);
drop function public.run_facts(uuid);

-- As in 20261121180000_team_run_facts, plus mode and sent_keys.
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
  last_story_at timestamptz,
  mode text,
  sent_keys text[]
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
            and r.coverage ->> 'status' = 'covered'),
         i.mode, i.sent_keys
  from public.interests i
  where i.id = p_interest
$$;

-- As in 20261121180000_team_run_facts, minus make runs while make mode is off.
create function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
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
      and public.is_team_topic(i.owner_id, i.visibility) = p_team
      and (i.mode = 'news' or exists (select 1 from public.settings where make_on))
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

-- As in 20261121070000_team_runner, and a queued make run fails while make
-- mode is off (a "Run now" made before it was switched off).
create function public.claim_runs(p_limit integer, p_now timestamptz default now())
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
                       when i.hidden_at is not null then 'interest hidden'
                       else 'make mode is off' end
  from public.interests i
  where i.id = r.interest_id and r.status = 'queued'
    and (i.deleted_at is not null or i.hidden_at is not null
         or (i.mode = 'make' and not exists (select 1 from public.settings where make_on)));

  if not public.spending_open(p_now) then
    return;
  end if;

  perform public.queue_due_runs(p_now, false);
  return query select * from public.claim_queued(p_limit, p_now, false);
end;
$$;

-- As in 20261121180000_team_run_facts, with the new row.
create function public.team_claim_runs(p_limit integer, p_now timestamptz default now())
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
  perform public.queue_due_runs(p_now, true);
  return query select * from public.claim_queued(p_limit, p_now, true);
end;
$$;

-- As in 20261121180000_team_run_facts, with the new row; a make topic cannot
-- start while make mode is off.
create function public.team_start_run(p_interest uuid, p_now timestamptz default now())
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
    where i.id = p_interest and public.is_team_topic(i.owner_id, i.visibility)
      and i.deleted_at is null and i.hidden_at is null
  ) then
    raise exception 'team_start_run: no such Scout team topic' using errcode = 'P0002';
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

revoke execute on function public.run_facts(uuid),
  public.claim_queued(integer, timestamptz, boolean),
  public.claim_runs(integer, timestamptz),
  public.team_claim_runs(integer, timestamptz),
  public.team_start_run(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_runs(integer, timestamptz),
  public.team_claim_runs(integer, timestamptz),
  public.team_start_run(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- The setup chat sets a topic's mode (as in 20261123000000_usage_logging).
-- ---------------------------------------------------------------------------

create or replace function public.commit_chat_turn(
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
        insert into public.interests (id, owner_id, topic, doc, mode)
        values ((v_change ->> 'interestId')::uuid, p_user,
                v_change ->> 'topic', coalesce(v_change ->> 'doc', ''),
                coalesce(v_change ->> 'mode', 'news'));
      when 'update' then
        update public.interests
        set topic = coalesce(v_change ->> 'topic', topic),
            doc = coalesce(v_change ->> 'doc', doc),
            mode = coalesce(v_change ->> 'mode', mode)
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
