-- Local accounts (profiles.runs_local): every topic of one, private too, runs
-- on the Scout team runner (the Mac), never on the Worker's claim_runs; it
-- skips the runs-per-day and spend caps at claim time; a reader cannot make
-- themself local. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('10ca1000-0000-4000-8000-000000000001', 'local@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated');

update public.profiles set plan = 'plus', runs_local = true
where id = '10ca1000-0000-4000-8000-000000000001';
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.settings set team_runner_on = true, paused = false;
update public.settings set daily_ceiling_usd = daily_ceiling_usd + 1000;

insert into public.interests
  (id, owner_id, topic, cadence, paused, run_at, run_weekday, visibility, created_at) values
  ('10ca1000-0000-4000-8000-0000000000d1', '10ca1000-0000-4000-8000-000000000001',
   'Local daily', 'daily', false, '07:00', 1, 'private', '2026-11-01'),
  ('10ca1000-0000-4000-8000-0000000000e1', '10ca1000-0000-4000-8000-000000000001',
   'Local run now', 'weekly', true, '07:00', 1, 'private', '2026-11-01'),
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna daily', 'daily', false, '07:00', 1, 'private', '2026-11-01');

-- A "Run now" on the local account, queued like any.
insert into public.runs (interest_id, scheduled_for, requested_by, created_at) values
  ('10ca1000-0000-4000-8000-0000000000e1', '2026-11-20 11:00+00',
   '10ca1000-0000-4000-8000-000000000001', '2026-11-20 11:00+00');

create function pg_temp.queued_topics() returns text[] language sql as $$
  select coalesce(array_agg(i.topic order by i.topic), '{}')
  from public.runs r join public.interests i on i.id = r.interest_id
  where r.status in ('queued', 'running')
    and i.owner_id in ('10ca1000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001')
$$;

-- ---------------------------------------------------------------------------
-- The Worker never takes a local account's runs
-- ---------------------------------------------------------------------------

select results_eq(
  $$select topic from public.claim_runs(50, '2026-11-20 12:00+00')
    where topic in ('Local daily', 'Local run now', 'Anna daily')$$,
  array['Anna daily'],
  'the Worker claims the others'' runs, never a local account''s');
select is(
  (select status from public.runs where interest_id = '10ca1000-0000-4000-8000-0000000000e1'),
  'queued', 'a local Run now waits in the queue for the Mac');
select is((select count(*)::int from public.runs
           where interest_id = '10ca1000-0000-4000-8000-0000000000d1'), 0,
  'the Worker does not queue a local account''s due topic');
update public.runs set status = 'ready', finished_at = '2026-11-20 12:01+00'
where interest_id = 'aaaaaaaa-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- The team runner does, private topics too, past the claim-time caps
-- ---------------------------------------------------------------------------

select results_eq(
  $$select topic || ' ' || due from public.team_topics('2026-11-20 12:00+00')
    where topic like 'Local %' or topic like 'Anna %'$$,
  array['Local daily true', 'Local run now true'],
  'team_topics lists a local account''s private topics, not other readers''');

-- No runs a day and no spend left on Plus: a local account still runs.
update public.plans set runs_per_day = 0, spend_per_day_usd = 0 where id = 'plus';

select results_eq(
  $$select topic from public.team_claim_runs(10, '2026-11-20 12:00+00') order by topic$$,
  array['Local daily', 'Local run now'],
  'the team runner claims a local account''s due topic and its Run now, past the runs-per-day and spend caps');
select is(pg_temp.queued_topics(), array['Local daily', 'Local run now'],
  'and Anna''s topic is not the team runner''s');

select ok(public.team_finish_run(
  (select id from public.runs where interest_id = '10ca1000-0000-4000-8000-0000000000d1'),
  '## Local daily', '{"topic":"Local daily","status":"covered"}', null, '2026-11-20 12:05+00'),
  'team_finish_run records a local run');
select is(
  (select status || ' ' || cost_usd from public.runs
   where interest_id = '10ca1000-0000-4000-8000-0000000000d1'),
  'ready 0.0000', 'ready, at no API cost');

select is(
  (select topic from public.team_start_run('10ca1000-0000-4000-8000-0000000000d1', '2026-11-20 13:00+00')),
  'Local daily', 'the runner can start a one-off run of a local topic');
select throws_ok($$select * from public.team_start_run('aaaaaaaa-0000-4000-8000-0000000000a1', '2026-11-20 13:00+00')$$,
  'P0002', null, 'but not of another reader''s topic');

-- ---------------------------------------------------------------------------
-- A reader cannot make themself local
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select runs_local from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  false, 'a reader reads their own runs_local');
select throws_ok(
  $$update public.profiles set runs_local = true where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'a reader cannot set runs_local');
reset role;

select ok(not has_function_privilege('authenticated', 'public.runs_on_mac(uuid, text)', 'execute'),
  'readers cannot call runs_on_mac');

select * from finish();
rollback;
