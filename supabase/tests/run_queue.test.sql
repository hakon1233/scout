-- Run queue tests: due times, claiming, the ceiling, the kill switch, retries,
-- the reaper and "run now". Run with `pnpm test:rls` against `supabase start`.
--
-- Ticks pass an explicit p_now (Friday 20 Nov 2026, 12:00 UTC; 13:00 in Oslo),
-- so due times do not depend on the clock. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project holds real spend today, so spend is measured from a
-- baseline taken before any fixture costs.
select set_config('scout.spend_noon', public.spend_today('2026-11-20 12:00+00')::text, true);
select set_config('scout.spend_1204', public.spend_today('2026-11-20 12:04+00')::text, true);

-- ---------------------------------------------------------------------------
-- Setup (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.test', 'authenticated', 'authenticated');

-- Sign-up already made both profiles (free, UTC).
update public.profiles set timezone = 'Europe/Oslo'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.interests
  (id, owner_id, topic, cadence, run_at, run_weekday, visibility, created_at) values
  -- Due: 07:00 Oslo today = 06:00 UTC.
  ('00000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna daily', 'daily', '07:00', 1, 'private', '2026-11-01'),
  -- Due, and public, so claimed first.
  ('00000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001',
   'House public', 'daily', '08:00', 1, 'public', '2026-11-01'),
  -- Not due: Monday's slot already has a run.
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna weekly', 'weekly', '07:00', 1, 'private', '2026-11-01'),
  -- Not due: off.
  ('00000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna paused', 'off', '07:00', 1, 'private', '2026-11-01'),
  -- Not due: yesterday 14:00 UTC already ran, today's 14:00 is later.
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Ben daily', 'daily', '14:00', 1, 'private', '2026-11-01'),
  -- Due: Fridays 11:00 UTC.
  ('00000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Ben weekly', 'weekly', '11:00', 5, 'private', '2026-11-01'),
  -- Not due: created after today's slot.
  ('00000000-0000-0000-0000-0000000000b3', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Ben new weekly', 'weekly', '09:00', 5, 'private', '2026-11-20 10:00+00');

insert into public.runs (interest_id, status, scheduled_for, started_at, finished_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'ready', '2026-11-16 06:00+00', '2026-11-16 06:00+00', '2026-11-16 06:02+00'),
  ('00000000-0000-0000-0000-0000000000b1', 'ready', '2026-11-19 14:00+00', '2026-11-19 14:00+00', '2026-11-19 14:02+00');

create temp table tick (run_id uuid, topic text, doc text, searches_per_run integer);

-- ---------------------------------------------------------------------------
-- Due times
-- ---------------------------------------------------------------------------

select is(public.last_run_slot('daily', '07:00', 1::smallint, 'Europe/Oslo', '2026-11-20 12:00+00'),
  '2026-11-20 06:00+00'::timestamptz, 'daily: today''s slot once its local time has passed');
select is(public.last_run_slot('daily', '14:00', 1::smallint, 'UTC', '2026-11-20 12:00+00'),
  '2026-11-19 14:00+00'::timestamptz, 'daily: yesterday''s slot before today''s time');
select is(public.last_run_slot('weekly', '11:00', 5::smallint, 'UTC', '2026-11-20 12:00+00'),
  '2026-11-20 11:00+00'::timestamptz, 'weekly: today when it is the day and the time has passed');
select is(public.last_run_slot('weekly', '13:00', 5::smallint, 'UTC', '2026-11-20 12:00+00'),
  '2026-11-13 13:00+00'::timestamptz, 'weekly: a week back when the time is still ahead today');
select is(public.last_run_slot('weekly', '07:00', 1::smallint, 'Europe/Oslo', '2026-11-20 12:00+00'),
  '2026-11-16 06:00+00'::timestamptz, 'weekly: the last Monday, in the owner''s time zone');
select is(public.last_run_slot('off', '07:00', 1::smallint, 'UTC', '2026-11-20 12:00+00'),
  null::timestamptz, 'off has no slot');

-- ---------------------------------------------------------------------------
-- Kill switch and ceiling: nothing is queued or claimed
-- ---------------------------------------------------------------------------

update public.settings set paused = true;
select is((select count(*)::int from public.claim_runs(10, '2026-11-20 12:00+00')), 0,
  'kill switch: no runs claimed');
select is((select count(*)::int from public.runs where status = 'queued'), 0,
  'kill switch: no runs queued');
update public.settings set paused = false;

insert into public.chat_turns (user_id, message, cost_usd, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'expensive', 10.00, '2026-11-20 11:00+00');
select is(public.spend_today('2026-11-20 12:00+00') - current_setting('scout.spend_noon')::numeric, 10.00::numeric, 'chat cost counts today');
select is((select count(*)::int from public.claim_runs(10, '2026-11-20 12:00+00')), 0,
  'ceiling reached: no runs claimed');
select ok(public.spending_open('2026-11-21 12:00+00'), 'the ceiling resets on the next UTC day');
delete from public.chat_turns where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

insert into tick select * from public.claim_runs(2, '2026-11-20 12:00+00');
select ok(exists(select 1 from tick where topic = 'House public'),
  'public interests are claimed first');
select is((select count(*)::int from tick), 2, 'a tick claims at most its batch');
select is((select searches_per_run from tick limit 1), 5, 'searches come from the owner''s plan');
select results_eq(
  $$select i.topic from public.runs r join public.interests i on i.id = r.interest_id
    where r.status in ('queued', 'running') order by i.topic$$,
  array['Anna daily', 'Ben weekly', 'House public'],
  'exactly the due interests are queued');
select is((select count(*)::int from public.runs where status = 'running' and attempts = 1
           and started_at = '2026-11-20 12:00+00'), 2, 'claimed runs are running');

delete from tick;
insert into tick select * from public.claim_runs(10, '2026-11-20 12:01+00');
select is((select count(*)::int from tick), 1, 'the next tick claims the one left');
select is((select count(*)::int from public.claim_runs(10, '2026-11-20 12:02+00')), 0,
  'nothing is due twice');

-- ---------------------------------------------------------------------------
-- Finishing, retry, reaper
-- ---------------------------------------------------------------------------

select ok(public.finish_run(
  (select r.id from public.runs r where r.interest_id = '00000000-0000-0000-0000-0000000000a3' and r.status = 'running'),
  '## House public', '{"topic":"House public","status":"covered"}', 4, 0.06, null, '2026-11-20 12:03+00'),
  'finish_run records a section');
select is(
  (select status || ' ' || cost_usd || ' ' || searches from public.runs
   where interest_id = '00000000-0000-0000-0000-0000000000a3' and section_md is not null),
  'ready 0.0600 4', 'a ready run keeps its cost and searches');
select is(public.spend_today('2026-11-20 12:04+00') - current_setting('scout.spend_1204')::numeric, 0.06::numeric, 'run cost counts today');

-- Ben weekly fails once: queued again; then fails for good with a notification.
select ok(public.finish_run(
  (select id from public.runs where interest_id = '00000000-0000-0000-0000-0000000000b2'),
  null, '{"topic":"Ben weekly","status":"missing"}', 1, 0.01, 'Claude API 529', '2026-11-20 12:03+00'),
  'finish_run records a failed attempt');
select is((select status from public.runs where interest_id = '00000000-0000-0000-0000-0000000000b2'),
  'queued', 'a first failure is queued again');
delete from tick;
insert into tick select * from public.claim_runs(10, '2026-11-20 12:04+00');
select results_eq('select topic from tick', array['Ben weekly'], 'the retry is claimed');
select ok(public.finish_run(
  (select id from public.runs where interest_id = '00000000-0000-0000-0000-0000000000b2'),
  null, null, 1, 0.01, 'Claude API 529', '2026-11-20 12:05+00'), 'second failure');
select is(
  (select status || ' ' || attempts || ' ' || cost_usd from public.runs
   where interest_id = '00000000-0000-0000-0000-0000000000b2' and scheduled_for > '2026-11-20'),
  'failed 2 0.0200', 'a second failure is final and the cost adds up');
select is((select count(*)::int from public.notifications
           where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and kind = 'run_failed'),
  1, 'the owner is told the run failed');
select ok(not public.finish_run(
  (select id from public.runs where interest_id = '00000000-0000-0000-0000-0000000000b2'
   and status = 'failed'), '## late', null, 0, 0, null, '2026-11-20 12:06+00'),
  'a run no longer running is not finished again');

-- Anna daily has been running since 12:00; at 12:12 the reaper takes it back.
select is((select count(*)::int from public.claim_runs(0, '2026-11-20 12:12+00')), 0,
  'a batch of 0 claims nothing');
select is(
  (select status || ' ' || error_msg from public.runs where interest_id = '00000000-0000-0000-0000-0000000000d1'),
  'queued the run stopped without a result', 'a stale running run is queued again');

-- A queued run of a deleted interest fails instead of running.
update public.interests set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000d1';
select is((select count(*)::int from public.claim_runs(10, '2026-11-20 12:13+00')), 0,
  'a deleted interest is not claimed');
select is((select status from public.runs where interest_id = '00000000-0000-0000-0000-0000000000d1'),
  'failed', 'its queued run fails');

-- ---------------------------------------------------------------------------
-- Run now
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.claim_runs(integer, timestamptz)', 'execute'),
  'readers cannot claim runs');
select ok(not has_function_privilege('authenticated',
  'public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz)', 'execute'),
  'readers cannot finish runs');
select ok(not has_function_privilege('anon', 'public.request_run(uuid)', 'execute'),
  'signed-out visitors cannot request runs');
select ok(has_function_privilege('service_role', 'public.claim_runs(integer, timestamptz)', 'execute'),
  'the service role claims runs');

update public.plans set on_demand_runs_per_day = 2 where id = 'free';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok($$select public.request_run('00000000-0000-0000-0000-0000000000b1')$$,
  'Ben asks for a run of his daily interest');
select is(public.request_run('00000000-0000-0000-0000-0000000000b1'),
  (select id from public.runs where interest_id = '00000000-0000-0000-0000-0000000000b1'
   and status = 'queued'),
  'asking again returns the queued run');
select is((public.allowance() -> 'used' ->> 'on_demand_runs_today')::int, 1,
  'asking again counts nothing');
select lives_ok($$select public.request_run('00000000-0000-0000-0000-0000000000b3')$$,
  'Ben asks for a second run');
select throws_ok($$select public.request_run('00000000-0000-0000-0000-0000000000b2')$$,
  'P0001', 'quota: 2 of 2 on-demand runs used today', 'the per-user limit holds');
select throws_ok($$select public.request_run('00000000-0000-0000-0000-0000000000a2')$$,
  'P0002', null, 'Ben cannot run Anna''s interest');

reset role;

select results_eq(
  $$select requested_by::text from public.runs where status = 'queued' order by requested_by$$,
  array['bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'],
  'run-now requests wait in the same queue');

select * from finish();
rollback;
