-- Per-reader limits: the chat reservation, the per-owner run and spend caps in
-- claim_runs and request_run, the 20-hour window per interest, paused
-- interests, the public cap and the spread default run time.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
--
-- Ticks pass p_now in 2030, past any real row on the hosted project, so the
-- global ceiling and other readers' runs never get in the way. Everything rolls
-- back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The schema's default ceiling: the hosted project's may be lower than this file spends.
update public.settings set daily_ceiling_usd = 10;

-- ---------------------------------------------------------------------------
-- Setup (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'lia@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'ben@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-0000000000c3', 'cleo@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-0000000000c4', 'tor@example.test', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-0000000000c5', 'eve@example.test', 'authenticated', 'authenticated');
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-0000000000c1';
update public.profiles set is_team = true where id = 'dddddddd-0000-0000-0000-0000000000c4';

insert into public.interests (id, owner_id, topic, cadence, run_at, paused) values
  ('00000000-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Lia daily', 'daily', '07:00', false),
  ('00000000-0000-0000-0000-00000000c002', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Lia paused', 'daily', '07:00', true),
  ('00000000-0000-0000-0000-00000000c003', 'bbbbbbbb-0000-0000-0000-0000000000c2',
   'Ben daily', 'daily', '07:00', false),
  ('00000000-0000-0000-0000-00000000c004', 'cccccccc-0000-0000-0000-0000000000c3',
   'Cleo daily', 'daily', '07:00', false),
  ('00000000-0000-0000-0000-00000000c005', 'dddddddd-0000-0000-0000-0000000000c4',
   'Tor daily', 'daily', '07:00', false);

create temp table tick (run_id uuid, topic text, doc text, searches_per_run integer);

-- ---------------------------------------------------------------------------
-- Default run time
-- ---------------------------------------------------------------------------

insert into public.interests (id, owner_id, topic) values
  ('00000000-0000-0000-0000-00000000c0ff', 'bbbbbbbb-0000-0000-0000-0000000000c2', 'Ben spread');
select ok((select run_at >= '07:00' and run_at < '08:00' from public.interests
    where id = '00000000-0000-0000-0000-00000000c0ff'),
  'a new interest runs at a random minute between 07:00 and 07:59');

-- ---------------------------------------------------------------------------
-- Runs and spend per owner, over the last 24 hours
-- ---------------------------------------------------------------------------

-- Ben ran 8 times in the last day (free plan: runs_per_day 8), at no cost.
insert into public.runs (interest_id, status, scheduled_for, started_at, finished_at, cost_usd, requested_by)
select '00000000-0000-0000-0000-00000000c003', 'ready', '2030-01-01 00:00+00',
       '2030-01-01 00:00+00'::timestamptz + n * interval '1 minute', '2030-01-01 01:00+00', 0,
       'bbbbbbbb-0000-0000-0000-0000000000c2'
from generate_series(1, 8) n;
-- Cleo ran 4 times with no recorded cost: $0.10 each reaches the free $0.40.
-- Tor did the same, but is the Scout team.
insert into public.runs (interest_id, status, scheduled_for, started_at, requested_by)
select i, 'failed', '2030-01-01 00:00+00', '2030-01-01 00:00+00'::timestamptz + n * interval '1 minute', o
from (values ('00000000-0000-0000-0000-00000000c004'::uuid, 'cccccccc-0000-0000-0000-0000000000c3'::uuid),
             ('00000000-0000-0000-0000-00000000c005'::uuid, 'dddddddd-0000-0000-0000-0000000000c4'::uuid)) v(i, o),
     generate_series(1, 4) n;

select is(public.user_spend_since('cccccccc-0000-0000-0000-0000000000c3', '2030-01-01 00:00+00'),
  0.40::numeric, 'a claimed run with no cost counts $0.10');

insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(10, '2030-01-01 08:00+00');
select results_eq($$ select topic from tick order by topic $$,
  array['Lia daily', 'Tor daily'],
  'Ben is at his runs per day and Cleo at her spend; Tor (team) is not capped; paused never queues');
select results_eq($$ select i.topic || ' ' || r.status from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.scheduled_for = '2030-01-01 07:00+00' order by 1 $$,
  array['Ben daily queued', 'Cleo daily queued', 'Lia daily running', 'Tor daily running'],
  'capped owners keep their runs queued until the 24 hours roll on');

-- A day later the old runs have rolled off: Ben and Cleo are claimed.
delete from tick;
update public.runs set status = 'ready', finished_at = '2030-01-01 08:05+00', cost_usd = 0.05
where status = 'running' and scheduled_for = '2030-01-01 07:00+00';
insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(10, '2030-01-02 00:30+00');
select results_eq($$ select topic from tick order by topic $$,
  array['Ben daily', 'Cleo daily'], 'once their last day rolls off, capped owners run');

-- ---------------------------------------------------------------------------
-- One scheduled run per interest per 20 hours, whatever the run time
-- ---------------------------------------------------------------------------

delete from tick;
update public.interests set run_at = '20:00' where id = '00000000-0000-0000-0000-00000000c001';
insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(10, '2030-01-01 21:00+00');
select is((select count(*)::int from tick where topic = 'Lia daily'), 0,
  'moving the run time later the same day gives no second run');
insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(10, '2030-01-02 21:00+00');
select is((select count(*)::int from tick where topic = 'Lia daily'), 1,
  'the next day runs at the new time');
select is((select count(*)::int from public.runs where interest_id = '00000000-0000-0000-0000-00000000c002'),
  0, 'a paused interest never queues');

-- ---------------------------------------------------------------------------
-- request_run stops at the owner's spend cap
-- ---------------------------------------------------------------------------

insert into public.interests (id, owner_id, topic) values
  ('00000000-0000-0000-0000-00000000c006', 'eeeeeeee-0000-0000-0000-0000000000c5', 'Eve topic');
insert into public.runs (interest_id, status, started_at, finished_at, cost_usd) values
  ('00000000-0000-0000-0000-00000000c006', 'ready', now() - interval '1 hour', now(), 0.40);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-0000000000c5","role":"authenticated"}', true);
select is((public.allowance() -> 'used' ->> 'spend_24h_usd')::numeric, 0.40::numeric,
  'allowance shows the spend of the last 24 hours');
select throws_ok($$ select public.request_run('00000000-0000-0000-0000-00000000c006') $$,
  'P0001', 'quota: spend limit of $0.40 reached', 'run now stops at the spend cap');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Chat: a reserved turn counts at once
-- ---------------------------------------------------------------------------

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.begin_chat_turn('eeeeeeee-0000-0000-0000-0000000000c5', 'hi'),
  '{"blocked": "You have reached today''s spending limit. Try again tomorrow."}'::jsonb,
  'a reader at the spend cap cannot chat');
reset role;

-- Ben has used 39 of 40 turns.
insert into public.chat_turns (user_id, message, status, cost_usd)
select 'bbbbbbbb-0000-0000-0000-0000000000c2', 'old', 'ready', 0 from generate_series(1, 39);

set local role service_role;
select set_config('scout.turn',
  public.begin_chat_turn('bbbbbbbb-0000-0000-0000-0000000000c2', 'the last one') ->> 'id', true);
select ok(current_setting('scout.turn') <> '', 'the 40th turn is reserved');
select is(public.begin_chat_turn('bbbbbbbb-0000-0000-0000-0000000000c2', 'one more'),
  '{"blocked": "You have used today''s 40 chat messages. Try again tomorrow."}'::jsonb,
  'the reservation counts at once, so a parallel request is refused');
select lives_ok(format($$ select public.commit_chat_turn('bbbbbbbb-0000-0000-0000-0000000000c2',
    '{"id":"%s","message":"the last one","reply":"done","status":"ready"}'::jsonb, '{}', 0.01) $$,
    current_setting('scout.turn')), 'the turn completes its reservation');
select throws_ok(format($$ select public.commit_chat_turn('bbbbbbbb-0000-0000-0000-0000000000c2',
    '{"id":"%s","message":"again","reply":"again","status":"ready"}'::jsonb, '{}', 0) $$,
    current_setting('scout.turn')), '23505', null, 'a completed turn cannot be written again');
select throws_ok(format($$ select public.commit_chat_turn('eeeeeeee-0000-0000-0000-0000000000c5',
    '{"id":"%s","message":"theirs","reply":"x","status":"ready"}'::jsonb, '{}', 0) $$,
    current_setting('scout.turn')), '23505', null, 'nor by another reader');
reset role;
select is((select reply || ' ' || status || ' ' || cost_usd from public.chat_turns
    where id = current_setting('scout.turn')::uuid), 'done ready 0.0100', 'the turn is saved once');
select is((select count(*)::int from public.chat_turns
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'), 40, 'no extra rows');

-- ---------------------------------------------------------------------------
-- At most 3 public interests each (the team excepted)
-- ---------------------------------------------------------------------------

insert into public.interests (owner_id, topic, visibility, share_slug)
select 'cccccccc-0000-0000-0000-0000000000c3', 'Cleo public ' || n, 'public',
       'cleopubliccleopublic' || n
from generate_series(1, 3) n;
select throws_ok($$ insert into public.interests (owner_id, topic, visibility, share_slug)
    values ('cccccccc-0000-0000-0000-0000000000c3', 'Cleo public 4', 'public', 'cleopubliccleopublic4') $$,
  'P0001', 'quota: 3 of 3 public interests used', 'a fourth public interest is refused');
select lives_ok($$ insert into public.interests (owner_id, topic, visibility, share_slug)
    select 'dddddddd-0000-0000-0000-0000000000c4', 'Tor public ' || n, 'public',
           'torpublictorpublictor' || n
    from generate_series(1, 4) n $$, 'the Scout team has no public cap');

select * from finish();
rollback;
