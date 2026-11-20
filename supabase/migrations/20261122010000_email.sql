-- Email: a topic's new brief in the reader's inbox. Per topic and per reader,
-- off by default, the same way as the push bell: the owner's switch is on the
-- interest, a follower's on the follow.
--
-- Off until `settings.email_on` is set. While off, my_topic_email answers null
-- (the web app hides the toggles), set_topic_email refuses, nothing is queued
-- and claim_emails answers null, so the Worker sends nothing.
--
-- When a run with stories becomes ready, a trigger queues one email_outbox row
-- per opted-in reader (one per reader per run: one email per topic per brief).
-- The Worker's email module (packages/worker/src/email.ts) claims rows, holds
-- each reader to the daily cap, sends through Resend and marks what it sent.
-- Addresses come from auth.users only.

alter table public.settings add column email_on boolean not null default false;

alter table public.interests add column email_enabled boolean not null default false;
alter table public.follows add column email_enabled boolean not null default false;

create table public.email_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  unique (user_id, run_id)
);

create index email_outbox_open_idx on public.email_outbox (id) where claimed_at is null;
create index email_outbox_sent_idx on public.email_outbox (user_id, sent_at);

-- Service role only: RLS on, no policies, no grants to readers.
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.email_outbox to service_role;

-- The readers to email about a ready run: the owner (live interest, email on)
-- and each follower (listed interest, email on for that follow).
create function public.email_targets(p_run uuid)
returns table (user_id uuid)
language sql stable security definer
set search_path = ''
as $$
  with ri as (
    select i from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.id = p_run and r.status = 'ready'
  )
  select (ri.i).owner_id from ri
  where (ri.i).deleted_at is null and (ri.i).email_enabled
  union
  select f.user_id from ri
  join public.follows f on f.interest_id = (ri.i).id
  where public.interest_is_listed(ri.i) and f.email_enabled
$$;

-- Queues the emails when a run with stories becomes ready (finish_run and
-- team_finish_run both get here), only while email is switched on.
create function public.queue_run_emails() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce((select email_on from public.settings), false) then
    insert into public.email_outbox (user_id, run_id)
    select t.user_id, new.id from public.email_targets(new.id) t
    on conflict (user_id, run_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger runs_queue_emails
  after update of status on public.runs
  for each row
  when (new.status = 'ready' and old.status is distinct from 'ready'
        and new.coverage ->> 'status' = 'covered')
  execute function public.queue_run_emails();

-- The caller's topics with email on, or null while email is switched off.
create function public.my_topic_email() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case when coalesce((select email_on from public.settings), false) then
    coalesce((
      select array_agg(id) from (
        select i.id from public.interests i
        where i.owner_id = auth.uid() and i.deleted_at is null and i.email_enabled
        union
        select f.interest_id from public.follows f
        where f.user_id = auth.uid() and f.email_enabled
      ) t), '{}')
  end
$$;

-- The caller switches email for one topic they own or follow. Returns whether
-- the switch was found. Refused while email is switched off.
create function public.set_topic_email(p_interest uuid, p_on boolean) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'set_topic_email: sign in first' using errcode = '42501';
  end if;
  if not coalesce((select email_on from public.settings), false) then
    raise exception 'set_topic_email: email is switched off' using errcode = '55000';
  end if;
  update public.interests set email_enabled = p_on
  where id = p_interest and owner_id = auth.uid();
  if found then
    return true;
  end if;
  update public.follows set email_enabled = p_on
  where interest_id = p_interest and user_id = auth.uid();
  return found;
end;
$$;

-- An email's unsubscribe link (the Worker checked its signature): turns that
-- reader's email off for that topic. Returns the topic, or null when the
-- reader neither owns nor follows it any more. Works with email switched off.
create function public.email_unsubscribe(p_user uuid, p_interest uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_topic text;
begin
  update public.interests set email_enabled = false
  where id = p_interest and owner_id = p_user
  returning topic into v_topic;
  if v_topic is null then
    update public.follows f set email_enabled = false
    from public.interests i
    where f.interest_id = p_interest and f.user_id = p_user and i.id = f.interest_id
    returning i.topic into v_topic;
  end if;
  return v_topic;
end;
$$;

-- Takes up to p_limit queued emails, oldest first, or answers null while email
-- is switched off. Each comes with the reader's address, the topic, the brief
-- and how many emails the reader was sent in the last 24 hours (the Worker
-- holds them to the daily cap). Rows never sent are dropped after a day, sent
-- ones after two.
create function public.claim_emails(p_limit integer, p_now timestamptz default now())
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not coalesce((select email_on from public.settings), false) then
    return null;
  end if;
  delete from public.email_outbox
  where (sent_at is null and created_at < p_now - interval '1 day')
     or sent_at < p_now - interval '2 days';

  with taken as (
    update public.email_outbox o set claimed_at = p_now
    where o.id in (
      select id from public.email_outbox
      where claimed_at is null
      order by id
      limit greatest(p_limit, 0)
      for update skip locked)
    returning o.id, o.user_id, o.run_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'user_id', t.user_id,
      'to', u.email,
      'interest_id', i.id,
      'topic', i.topic,
      'section_md', r.section_md,
      'sent_today', (select count(*) from public.email_outbox s
                     where s.user_id = t.user_id and s.sent_at > p_now - interval '24 hours'))
      order by t.id), '[]')
  into v_out
  from taken t
  join auth.users u on u.id = t.user_id and u.email is not null
  join public.runs r on r.id = t.run_id
  join public.interests i on i.id = r.interest_id;
  return v_out;
end;
$$;

-- Marks claimed emails as sent; they count toward the reader's daily cap.
create function public.emails_sent(p_ids bigint[], p_now timestamptz default now())
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.email_outbox set sent_at = p_now
  where id = any(p_ids) and claimed_at is not null and sent_at is null
$$;

revoke execute on function public.email_targets(uuid), public.queue_run_emails(),
  public.my_topic_email(), public.set_topic_email(uuid, boolean),
  public.email_unsubscribe(uuid, uuid), public.claim_emails(integer, timestamptz),
  public.emails_sent(bigint[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.my_topic_email(), public.set_topic_email(uuid, boolean)
  to authenticated;
grant execute on function public.email_targets(uuid), public.email_unsubscribe(uuid, uuid),
  public.claim_emails(integer, timestamptz), public.emails_sent(bigint[], timestamptz)
  to service_role;
