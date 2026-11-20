-- Reader feedback from the hosted setup chat (core's feedback.ts). The chat
-- drafts a note on a card; the reader's Confirm reaches send_feedback through
-- the Worker, which stores it here and appends the confirm turn. Only admins
-- read the table (in the Supabase dashboard); readers never touch it directly.
-- Off until `settings.feedback_on` is set: while off the chat offers nothing
-- and send_feedback refuses.

alter table public.settings add column feedback_on boolean not null default false;

-- A free chat turn (a feedback confirm) does not count toward the daily chat
-- message limit.
alter table public.chat_turns add column free boolean not null default false;

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The chat turn that held the card; one note per card.
  turn_id uuid not null unique,
  kind text not null check (kind in ('bug', 'wish', 'other')),
  summary text not null check (char_length(summary) between 1 and 120),
  text text not null check (char_length(text) between 1 and 2000),
  -- The reader's plan when they sent it.
  plan text
);

create index feedback_created_idx on public.feedback (created_at);
create index feedback_user_idx on public.feedback (user_id, created_at);

alter table public.feedback enable row level security;

create policy feedback_admin_read on public.feedback
  for select to authenticated
  using (coalesce((select is_admin from public.profiles where id = auth.uid()), false));

revoke all on public.feedback from public, anon, authenticated;
grant select on public.feedback to authenticated;

-- Store the reader's feedback card from chat turn p_card_turn and append the
-- confirm turn p_turn (a chat_turns row as core's chatTurnToRow writes it) as a
-- free turn. Returns null when sent, or the reason it was not (5 a reader and
-- 200 overall in 24 hours), which also becomes the stored turn's reply.
create or replace function public.send_feedback(
  p_user uuid, p_card_turn uuid, p_feedback jsonb, p_turn jsonb,
  p_now timestamptz default now()
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_since timestamptz := p_now - interval '24 hours';
  v_reason text;
begin
  if not coalesce((select feedback_on from public.settings), false) then
    raise exception 'send_feedback: feedback is switched off' using errcode = '55000';
  end if;
  -- One sender at a time, so two confirms cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('feedback:' || p_user::text));
  if not exists (
    select 1 from public.chat_turns where id = p_card_turn and user_id = p_user
  ) then
    raise exception 'send_feedback: turn % is not this reader''s', p_card_turn
      using errcode = '42501';
  end if;

  if (select count(*) from public.feedback
      where user_id = p_user and created_at > v_since and created_at <= p_now) >= 5 then
    v_reason := 'You have sent 5 notes to the Scout team today. Try again tomorrow.';
  elsif (select count(*) from public.feedback
      where created_at > v_since and created_at <= p_now) >= 200 then
    v_reason := 'Scout''s feedback inbox is full for today. Try again tomorrow.';
  else
    insert into public.feedback (user_id, turn_id, kind, summary, text, plan, created_at)
    values (p_user, p_card_turn, p_feedback ->> 'kind', p_feedback ->> 'summary',
            p_feedback ->> 'text',
            (select plan from public.profiles where id = p_user), p_now)
    on conflict (turn_id) do nothing;
  end if;

  insert into public.chat_turns
    (id, user_id, message, reply, changes, pending, status, cost_usd, error_msg, created_at, free)
  values (
    (p_turn ->> 'id')::uuid, p_user, p_turn ->> 'message',
    coalesce(v_reason, p_turn ->> 'reply'),
    nullif(p_turn -> 'changes', 'null'::jsonb), nullif(p_turn -> 'pending', 'null'::jsonb),
    'ready', 0, null, coalesce((p_turn ->> 'created_at')::timestamptz, p_now), true);
  return v_reason;
end;
$$;

revoke execute on function public.send_feedback(uuid, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.send_feedback(uuid, uuid, jsonb, jsonb, timestamptz)
  to service_role;

-- allowance() as in 20261121010000_limits.sql, except a free chat turn does not
-- count in chat_turns_today.
create or replace function public.allowance(p_user uuid default auth.uid()) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_since timestamptz := now() - interval '24 hours';
begin
  if p_user is null then
    raise exception 'allowance: no user' using errcode = '22004';
  end if;
  if auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'allowance: not your account' using errcode = '42501';
  end if;

  select pl.* into v_plan
  from (select 1) one
  left join public.profiles pr on pr.id = p_user
  join public.plans pl on pl.id = coalesce(pr.plan, 'free');

  return jsonb_build_object(
    'plan', v_plan.id,
    'used', jsonb_build_object(
      'interests', (
        select count(*) from public.interests
        where owner_id = p_user and deleted_at is null),
      'daily_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'daily' and deleted_at is null),
      'weekly_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'weekly' and deleted_at is null),
      'public_interests', (
        select count(*) from public.interests
        where owner_id = p_user and visibility = 'public' and deleted_at is null),
      'on_demand_runs_today', (
        select count(*) from public.runs
        where requested_by = p_user and created_at >= v_since),
      'chat_turns_today', (
        select count(*) from public.chat_turns
        where user_id = p_user and created_at >= v_since and not free),
      'runs_24h', public.user_runs_since(p_user, v_since),
      'spend_24h_usd', public.user_spend_since(p_user, v_since)
    ),
    'limits', to_jsonb(v_plan) - 'id'
  );
end;
$$;
