-- Push: real push services only, at most 5 devices a reader, a per-topic
-- switch, and an outbox the Worker drains a few rows per tick
-- (plan/research/fable-review.md items 4, 8, 9).
--
-- finish_run queues one outbox row per device to tell when a run with stories
-- is ready; the Worker's cron takes rows with claim_outbox (which deletes them)
-- and sends them within its subrequest budget, so a big audience is spread over
-- ticks instead of dropped.

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

delete from public.push_subscriptions
where endpoint !~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/';

alter table public.push_subscriptions add constraint push_subscriptions_endpoint_service
  check (endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/');

-- Per-topic push switch: the owner's on the interest, a follower's on the follow.
-- Off by default: a reader turns it on per topic to hear of each new brief;
-- the rest hear once a week (queue_weekly_pushes). Settings are per reader,
-- never per device, so a device that changes hands carries none of the old
-- reader's.
alter table public.interests add column push_enabled boolean not null default false;
alter table public.follows add column push_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

create table public.outbox (
  id bigint generated always as identity primary key,
  kind text not null default 'push' check (kind in ('push', 'weekly')),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index outbox_subscription_idx on public.outbox (subscription_id);
create index outbox_user_idx on public.outbox (user_id);

-- Service role only: RLS on, no policies, no grants to readers.
alter table public.outbox enable row level security;
revoke all on public.outbox from anon, authenticated;

-- Saves the caller's device. A device another reader saved before becomes the
-- caller's, with its queued pushes dropped. Keeps the caller's 5 newest devices.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'save_push_subscription: sign in first' using errcode = '42501';
  end if;
  delete from public.outbox o
  using public.push_subscriptions s
  where o.subscription_id = s.id and s.endpoint = p_endpoint and s.user_id <> auth.uid();

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, clock_timestamp())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        created_at = excluded.created_at;

  delete from public.push_subscriptions
  where user_id = auth.uid() and id not in (
    select id from public.push_subscriptions
    where user_id = auth.uid()
    order by created_at desc, id
    limit 5);
end;
$$;

-- The devices to tell that a run's brief is ready: the owner's (live interest,
-- push on) and each follower's (listed interest, push on for that follow).
drop function public.push_targets(uuid);
create function public.push_targets(p_run uuid)
returns table (subscription_id uuid, user_id uuid, topic text)
language sql stable security definer
set search_path = ''
as $$
  with ri as (
    select i from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.id = p_run and r.status = 'ready'
  ), readers as (
    select (ri.i).owner_id as user_id from ri
    where (ri.i).deleted_at is null and (ri.i).push_enabled
    union
    select f.user_id from ri
    join public.follows f on f.interest_id = (ri.i).id
    where public.interest_is_listed(ri.i) and f.push_enabled
  )
  select s.id, s.user_id, (ri.i).topic
  from readers rd
  join public.push_subscriptions s on s.user_id = rd.user_id
  cross join ri
$$;

-- The caller switches pushes for one topic they own or follow. Returns whether
-- the switch was found.
create function public.set_topic_push(p_interest uuid, p_on boolean) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'set_topic_push: sign in first' using errcode = '42501';
  end if;
  update public.interests set push_enabled = p_on
  where id = p_interest and owner_id = auth.uid();
  if found then
    return true;
  end if;
  update public.follows set push_enabled = p_on
  where interest_id = p_interest and user_id = auth.uid();
  return found;
end;
$$;

-- Takes (and deletes) up to p_limit queued pushes, oldest first, with what the
-- Worker needs to send each. kind 'push': payload {run_id, topic}; kind
-- 'weekly': payload {count, topics, popular}.
create function public.claim_outbox(p_limit integer)
returns table (endpoint text, p256dh text, auth text, kind text, payload jsonb)
language sql volatile security definer
set search_path = ''
as $$
  with taken as (
    delete from public.outbox o
    where o.id in (
      select id from public.outbox
      order by id
      limit greatest(p_limit, 0)
      for update skip locked)
    returning o.subscription_id, o.kind, o.payload
  )
  select s.endpoint, s.p256dh, s.auth, t.kind, t.payload
  from taken t join public.push_subscriptions s on s.id = t.subscription_id
$$;

-- ---------------------------------------------------------------------------
-- finish_run: queue the pushes when a run with stories is ready
-- ---------------------------------------------------------------------------

create or replace function public.finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_searches integer,
  p_cost_usd numeric,
  p_error text default null,
  p_now timestamptz default now()
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
    perform public.fail_run_attempt(p_run, coalesce(p_error, 'no section'), p_now);
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.save_push_subscription(text, text, text),
  public.push_targets(uuid), public.set_topic_push(uuid, boolean),
  public.claim_outbox(integer)
  from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text),
  public.set_topic_push(uuid, boolean) to authenticated;
grant execute on function public.push_targets(uuid), public.claim_outbox(integer)
  to service_role;
grant select, insert, delete on public.outbox to service_role;
