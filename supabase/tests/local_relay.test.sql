-- The local account relay: the cron's claim_picks never claims a local reader
-- (profiles.runs_local); team_claim_picks hands them to the Mac with no spend
-- gate, only while the team runner is on; team_pick_job reloads an open claim;
-- publish_relay_start reopens an open publish check without counting it again.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

delete from public.reader_picks;
delete from public.pick_runs;

-- Lars is a local account; Anna is not.
insert into auth.users (id, email, aud, role) values
  ('10ca1000-0000-4000-8000-000000000002', 'lars@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'anna@example.test', 'authenticated', 'authenticated');
update public.profiles set plan = 'plus', runs_local = true
where id = '10ca1000-0000-4000-8000-000000000002';
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.settings set team_runner_on = false, paused = false;

-- A profile change asks both for new picks.
update public.profiles set role = 'Nurse'
where id in ('10ca1000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002');
select is((select count(*)::int from public.reader_picks where requested_at is not null), 2,
  'both readers are due new picks');

-- ---------------------------------------------------------------------------
-- The cron's picks skip a local reader
-- ---------------------------------------------------------------------------

create temp table api as select public.claim_picks(5, now()) as c;
select results_eq(
  $$select e ->> 'user_id' from api, jsonb_array_elements(c) e$$,
  array['aaaaaaaa-0000-0000-0000-000000000002'],
  'claim_picks claims the API reader, never the local one');
select ok((select requested_at is not null from public.reader_picks
           where user_id = '10ca1000-0000-4000-8000-000000000002'),
  'the local reader still waits for the Mac');

-- ---------------------------------------------------------------------------
-- The Mac's picks
-- ---------------------------------------------------------------------------

select is(public.team_claim_picks(5, now()), '[]'::jsonb, 'nothing while the team runner is off');
update public.settings set team_runner_on = true;

-- No spend left today: a local reader's picks still run (they cost no API dollars).
update public.plans set spend_per_day_usd = 0 where id = 'plus';

create temp table mac as select public.team_claim_picks(5, now()) as c;
select results_eq(
  $$select (e ->> 'user_id') || ' ' || (e ->> 'kind') from mac, jsonb_array_elements(c) e$$,
  array['10ca1000-0000-4000-8000-000000000002 profile'],
  'team_claim_picks claims the local reader only, past the spend cap');
select ok((select c -> 0 -> 'input' ? 'candidates' from mac), 'with the picks input');
select is(public.team_claim_picks(5, now()), '[]'::jsonb, 'a claimed reader is not claimed twice');

select is(public.team_pick_job((select (c -> 0 ->> 'run_id')::bigint from mac)) ->> 'user_id',
  '10ca1000-0000-4000-8000-000000000002', 'team_pick_job reloads the open claim');
select throws_ok(
  format('select public.team_pick_job(%s)', (select (c -> 0 ->> 'run_id')::bigint from api)),
  'P0002', null, 'but never an API reader''s');
select throws_ok(
  format('select public.team_pick_job(%s, now() + interval ''2 hours'')',
         (select (c -> 0 ->> 'run_id')::bigint from mac)),
  'P0002', null, 'nor one claimed over an hour ago');

select is(public.finish_picks('10ca1000-0000-4000-8000-000000000002',
  (select (c -> 0 ->> 'run_id')::bigint from mac), '[]'::jsonb, 0, null,
  public.picks_version(), 900, 40), 0, 'the Mac''s answer is recorded at no cost');
select is((select cost_usd || ' ' || input_tokens from public.pick_runs
           where id = (select (c -> 0 ->> 'run_id')::bigint from mac)), '0 900',
  'with its tokens');
select throws_ok(
  format('select public.team_pick_job(%s)', (select (c -> 0 ->> 'run_id')::bigint from mac)),
  'P0002', null, 'a finished claim is not reopened');

-- ---------------------------------------------------------------------------
-- A relayed publish check reopens its check without counting it again
-- ---------------------------------------------------------------------------

insert into public.interests (id, owner_id, topic, doc, cadence) values
  ('10ca1000-0000-4000-8000-0000000000b2', '10ca1000-0000-4000-8000-000000000002',
   'Fjord kayaking', 'Trips and gear.', 'off');
create temp table started as
  select public.publish_start('10ca1000-0000-4000-8000-000000000002',
                              '10ca1000-0000-4000-8000-0000000000b2') as s;

select is(
  public.publish_relay_start('10ca1000-0000-4000-8000-000000000002',
                             (select (s ->> 'checkId')::bigint from started)),
  (select s from started), 'publish_relay_start returns what publish_start did');
select is((select count(*)::int from public.publish_checks
           where user_id = '10ca1000-0000-4000-8000-000000000002'), 1,
  'and opens no second check');
select throws_ok(
  format('select public.publish_relay_start(%L, %s)', 'aaaaaaaa-0000-0000-0000-000000000002',
         (select (s ->> 'checkId')::bigint from started)),
  'P0002', null, 'another reader cannot reopen it');
select is(public.publish_finish('10ca1000-0000-4000-8000-000000000002',
  (select (s ->> 'checkId')::bigint from started), false, '{}', 'Too vague.', 0, 900, 40),
  null, 'the refusal is recorded');
select throws_ok(
  format('select public.publish_relay_start(%L, %s)', '10ca1000-0000-4000-8000-000000000002',
         (select (s ->> 'checkId')::bigint from started)),
  'P0002', null, 'a finished check is not reopened');

-- ---------------------------------------------------------------------------
-- Readers cannot call any of it
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.team_claim_picks(integer, timestamptz)', 'execute'),
  'readers cannot claim the Mac''s picks');
select ok(not has_function_privilege('authenticated', 'public.team_pick_job(bigint, timestamptz)', 'execute'),
  'readers cannot reload a claim');
select ok(not has_function_privilege('authenticated', 'public.publish_relay_start(uuid, bigint)', 'execute'),
  'readers cannot reopen a check');
select ok(not has_function_privilege('authenticated', 'public.claim_due_picks(integer, timestamptz, boolean)', 'execute'),
  'readers cannot call the claim loop');

select * from finish();
rollback;
