-- The Scout team runner and hiding public topics: one owner per run, paused
-- test topics never run on the schedule, the team functions touch only the
-- team's public topics, and a hidden topic disappears for everyone but its
-- owner. Run with `pnpm test:rls`. Everything rolls back at the end.
--
-- The test makes its own team account (settings.team_owner), so the hosted
-- project's real catalog rows play no part.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('7ea70000-0000-4000-8000-000000000001', 'team@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated');

update public.profiles set is_admin = true where id = '7ea70000-0000-4000-8000-000000000001';
update public.settings set team_owner = '7ea70000-0000-4000-8000-000000000001',
  team_runner_on = false, paused = false;
-- Other rows of the hosted project stay out of the Worker's claims below.
update public.settings set daily_ceiling_usd = daily_ceiling_usd + 1000;

insert into public.interests
  (id, owner_id, topic, cadence, paused, run_at, run_weekday, visibility, share_slug, created_at) values
  -- A team topic due daily at 07:00 UTC.
  ('7ea70000-0000-4000-8000-0000000000d1', '7ea70000-0000-4000-8000-000000000001',
   'Team daily', 'daily', false, '07:00', 1, 'public', 'team-test-daily-000001', '2026-11-01'),
  -- A seeded test topic: daily, but paused.
  ('7ea70000-0000-4000-8000-0000000000f1', '7ea70000-0000-4000-8000-000000000001',
   'Team paused', 'daily', true, '07:00', 1, 'public', 'team-test-paused-00001', '2026-11-01'),
  -- The team account's private topic is not a team topic.
  ('7ea70000-0000-4000-8000-0000000000e1', '7ea70000-0000-4000-8000-000000000001',
   'Team private', 'daily', false, '07:00', 1, 'private', null, '2026-11-01'),
  -- Anna's public topic (she is no team).
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna public', 'daily', false, '07:00', 1, 'public', 'anna-test-public-00001', '2026-11-01');

create temp table tick (run_id uuid, topic text, doc text, searches_per_run integer);
create function pg_temp.queued_topics() returns text[] language sql as $$
  select coalesce(array_agg(i.topic order by i.topic), '{}')
  from public.runs r join public.interests i on i.id = r.interest_id
  where r.status in ('queued', 'running')
    and i.owner_id in ('7ea70000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001')
$$;

-- ---------------------------------------------------------------------------
-- Runner off: the Worker runs everything that is due, never a paused topic
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.team_claim_runs(10, '2026-11-20 12:00+00')), 0,
  'the team runner claims nothing while it is off');
select throws_ok($$select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000f1', '2026-11-20 12:00+00')$$,
  '55000', null, 'nor starts a one-off run');

insert into tick select * from public.claim_runs(50, '2026-11-20 12:00+00');
select is(pg_temp.queued_topics(), array['Anna public', 'Team daily', 'Team private'],
  'runner off: the Worker runs the team''s due topics; a paused topic never');
update public.runs set status = 'ready', finished_at = '2026-11-20 12:01+00'
where id in (select run_id from tick);
delete from tick;

-- ---------------------------------------------------------------------------
-- Runner on: one owner per run
-- ---------------------------------------------------------------------------

update public.settings set team_runner_on = true;

insert into tick select * from public.claim_runs(50, '2026-11-21 12:00+00');
select is(pg_temp.queued_topics(), array['Anna public', 'Team private'],
  'runner on: the Worker skips the team''s public topics and paused topics');
update public.runs set status = 'ready', finished_at = '2026-11-21 12:01+00'
where id in (select run_id from tick);
delete from tick;

select results_eq(
  $$select topic || ' ' || due from public.team_topics('2026-11-21 12:00+00')$$,
  array['Team daily true', 'Team paused false'],
  'team_topics lists the team''s public topics and which are due, claiming nothing');
select is(pg_temp.queued_topics(), '{}'::text[], 'team_topics queues nothing');

insert into tick select * from public.team_claim_runs(1, '2026-11-21 12:00+00');
select results_eq('select topic from tick', array['Team daily'],
  'the team runner claims its due topic');
select is((select count(*)::int from public.team_claim_runs(10, '2026-11-21 12:01+00')), 0,
  'and never a paused topic');

select ok(public.team_finish_run((select run_id from tick),
  '## Team daily', '{"topic":"Team daily","status":"covered"}', null, '2026-11-21 12:05+00'),
  'team_finish_run records the section');
select is(
  (select status || ' ' || cost_usd || ' ' || searches from public.runs where id = (select run_id from tick)),
  'ready 0.0000 0', 'a team run is ready like any run and costs no API dollars');
delete from tick;

-- A one-off test run of the paused topic; it stays paused.
insert into tick select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000f1', '2026-11-21 13:00+00');
select results_eq('select topic from tick', array['Team paused'], 'a one-off run starts');
select is((select status from public.runs where id = (select run_id from tick)), 'running',
  'it starts running, so the Worker never sees it queued');
select throws_ok($$select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000f1', '2026-11-21 13:01+00')$$,
  '23505', null, 'one run at a time per topic');
select is((select paused from public.interests where id = '7ea70000-0000-4000-8000-0000000000f1'),
  true, 'the topic stays paused');

select throws_ok($$select * from public.team_start_run('aaaaaaaa-0000-4000-8000-0000000000a1')$$,
  'P0002', null, 'the team runner cannot start someone else''s topic');
select throws_ok($$select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000e1')$$,
  'P0002', null, 'nor the team''s private topic');

update public.runs set status = 'running', started_at = '2026-11-21 12:00+00', attempts = 1
where interest_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' and finished_at = '2026-11-21 12:01+00';
select throws_ok(
  $$select public.team_finish_run(
      (select id from public.runs where interest_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
       and status = 'running'), '## Spam', null)$$,
  'P0002', null, 'team_finish_run refuses a run that is not the team''s');

-- ---------------------------------------------------------------------------
-- Hiding
-- ---------------------------------------------------------------------------

select ok(public.team_hide_interest('aaaaaaaa-0000-4000-8000-0000000000a1', 'spam', 'moderation-token'),
  'a public topic is hidden');
select ok(not public.team_hide_interest('aaaaaaaa-0000-4000-8000-0000000000a1', 'spam', 'moderation-token'),
  'hiding twice changes nothing');
select is((select count(*)::int from public.moderation_log
           where interest_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 1, 'the hide is logged once');
select ok((select deleted_at is null and hidden_reason = 'spam' from public.interests
           where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 'hidden, never deleted');
select throws_ok($$select public.team_hide_interest('7ea70000-0000-4000-8000-0000000000e1', 'x', 'moderation-token')$$,
  'P0002', null, 'only public topics are hidden');
select throws_ok($$select public.team_hide_interest('7ea70000-0000-4000-8000-0000000000d1', ' ', 'moderation-token')$$,
  '22023', null, 'a hide needs a reason');

set local role anon;
select is((select count(*)::int from public.interests where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 0,
  'a hidden topic is gone from the catalog');
select is(public.interest_by_slug('anna-test-public-00001'), null::jsonb, 'and from its link');
select is((select count(*)::int from public.interests where id = '7ea70000-0000-4000-8000-0000000000d1'), 1,
  'other public topics stay');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"7ea70000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.follow('anna-test-public-00001')$$, 'P0002', null,
  'no one can follow a hidden topic');
reset role;

select is((select count(*)::int from public.claim_runs(50, '2026-11-22 12:00+00') c
           where c.topic = 'Anna public'), 0, 'a hidden topic does not run');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.team_claim_runs(integer, timestamptz)', 'execute'),
  'readers cannot claim team runs');
select ok(not has_function_privilege('authenticated', 'public.team_hide_interest(uuid, text, text)', 'execute'),
  'readers cannot hide topics');
select ok(not has_function_privilege('anon', 'public.team_topics(timestamptz)', 'execute'),
  'visitors cannot list team topics');
select ok(has_function_privilege('service_role',
  'public.team_finish_run(uuid, text, jsonb, text, timestamptz)', 'execute'),
  'the Worker finishes team runs');

select * from finish();
rollback;
