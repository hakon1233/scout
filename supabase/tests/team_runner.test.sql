-- The Scout team runner and hiding public topics: the Worker never runs the
-- team's public topics (runner on or off), one owner per run, paused
-- test topics never run on the schedule, the team functions touch only the
-- team's public topics, and a hidden topic disappears for everyone but its
-- owner. Run with `pnpm test:rls`. Everything rolls back at the end.
--
-- The test makes its own team account (profiles.is_team), so the hosted
-- project's real catalog rows play no part.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('7ea70000-0000-4000-8000-000000000001', 'team@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated');

update public.profiles set is_admin = true, is_team = true
where id = '7ea70000-0000-4000-8000-000000000001';
-- Anna is on Plus so her public topic may run daily (Free has no daily topic).
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.settings set team_runner_on = false, paused = false;
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

select is((select count(*)::int from public.interests
           where owner_id = '7ea70000-0000-4000-8000-000000000001' and cadence = 'daily'), 3,
  'a team account has no interest caps (the free plan allows no daily topic)');

create temp table tick (run_id uuid, topic text, doc text, searches_per_run integer);
-- What a team claim or start hands the runner: the same row claim_runs hands the Worker.
create temp table team_tick (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz);
create function pg_temp.facts() returns text language sql as $$
  select brief_length || ' ' || story_count || ' ' || evergreen || ' ' ||
         coalesce(search_locale, '-') || ' ' || cadence || ' ' ||
         jsonb_array_length(prior) || ' ' || coalesce(prior -> 0 ->> 'section_md', '-') || ' ' ||
         coalesce(to_char(last_story_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
  from team_tick
$$;
create function pg_temp.queued_topics() returns text[] language sql as $$
  select coalesce(array_agg(i.topic order by i.topic), '{}')
  from public.runs r join public.interests i on i.id = r.interest_id
  where r.status in ('queued', 'running')
    and i.owner_id in ('7ea70000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001')
$$;

-- ---------------------------------------------------------------------------
-- Runner off: team topics do not run at all; the Worker runs the rest
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.team_claim_runs(10, '2026-11-20 12:00+00')), 0,
  'the team runner claims nothing while it is off');
select throws_ok($$select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000f1', '2026-11-20 12:00+00')$$,
  '55000', null, 'nor starts a one-off run');

insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(50, '2026-11-20 12:00+00');
select is(pg_temp.queued_topics(), array['Anna public', 'Team private'],
  'runner off: the Worker never runs the team''s public topics, nor a paused topic');
select is((select count(*)::int from public.runs
           where interest_id = '7ea70000-0000-4000-8000-0000000000d1'), 0,
  'runner off: a due team topic is not even queued; it waits for the local runner');
update public.runs set status = 'ready', finished_at = '2026-11-20 12:01+00'
where id in (select run_id from tick);
delete from tick;

-- ---------------------------------------------------------------------------
-- Runner on: one owner per run
-- ---------------------------------------------------------------------------

update public.settings set team_runner_on = true;

insert into tick select run_id, topic, doc, searches_per_run from public.claim_runs(50, '2026-11-21 12:00+00');
select is(pg_temp.queued_topics(), array['Anna public', 'Team private'],
  'runner on: the Worker skips the team''s public topics and paused topics');
update public.runs set status = 'ready', finished_at = '2026-11-21 12:01+00'
where id in (select run_id from tick);
delete from tick;

-- Only this file's topics: the hosted project has its own team topics.
select results_eq(
  $$select topic || ' ' || due from public.team_topics('2026-11-21 12:00+00')
    where topic like 'Team %'$$,
  array['Team daily true', 'Team paused false'],
  'team_topics lists the team''s public topics and which are due, claiming nothing');
select is(pg_temp.queued_topics(), '{}'::text[], 'team_topics queues nothing');

-- Team daily has settings and earlier briefs: a story two days ago, nothing new yesterday.
update public.interests set brief_length = 'long', story_count = 2, evergreen = true,
  search_locale = 'nb-NO'
where id = '7ea70000-0000-4000-8000-0000000000d1';
insert into public.runs (interest_id, scheduled_for, status, started_at, finished_at, section_md, coverage, attempts) values
  ('7ea70000-0000-4000-8000-0000000000d1', '2026-11-19 07:00+00', 'ready', '2026-11-19 07:00+00',
   '2026-11-19 07:05+00', '## Team daily' || chr(10) || '- Old story', '{"topic":"Team daily","status":"covered"}', 1),
  ('7ea70000-0000-4000-8000-0000000000d1', '2026-11-20 07:00+00', 'ready', '2026-11-20 07:00+00',
   '2026-11-20 07:05+00', '## Team daily' || chr(10) || 'No change since 19 Nov.', '{"topic":"Team daily","status":"empty"}', 1);

insert into team_tick select * from public.team_claim_runs(1, '2026-11-21 12:00+00');
insert into tick select run_id, topic, doc, searches_per_run from team_tick;
select results_eq('select topic from tick', array['Team daily'],
  'the team runner claims its due topic');
select is(pg_temp.facts(),
  'long 2 true nb-NO daily 2 ## Team daily' || chr(10) || 'No change since 19 Nov. 2026-11-19 07:05',
  'a team claim carries the brief settings, the last two sections, the cadence and the last story''s date');
delete from team_tick;
select is((select count(*)::int from public.team_claim_runs(10, '2026-11-21 12:01+00')), 0,
  'and never a paused topic');

-- The team owner wants pushes for Team daily: a covered team run queues one.
update public.interests set push_enabled = true where id = '7ea70000-0000-4000-8000-0000000000d1';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('7ea70000-0000-4000-8000-000000000001', 'https://fcm.googleapis.com/fcm/send/team-test', 'k', 'a');

select ok(public.team_finish_run((select run_id from tick),
  '## Team daily', '{"topic":"Team daily","status":"covered"}', null, '2026-11-21 12:05+00'),
  'team_finish_run records the section');
select is(
  (select status || ' ' || cost_usd || ' ' || searches from public.runs where id = (select run_id from tick)),
  'ready 0.0000 0', 'a team run is ready like any run and costs no API dollars');
select is((select count(*)::int from public.outbox where payload ->> 'run_id' = (select run_id::text from tick)), 1,
  'and its readers'' pushes are queued like any run''s');
delete from tick;

-- A one-off test run of the paused topic; it stays paused.
insert into public.runs (interest_id, scheduled_for, status, started_at, finished_at, section_md, coverage, attempts) values
  ('7ea70000-0000-4000-8000-0000000000f1', '2026-11-20 07:00+00', 'ready', '2026-11-20 07:00+00',
   '2026-11-20 07:05+00', '## Team paused' || chr(10) || 'No news yet.', '{"topic":"Team paused","status":"empty"}', 1);
insert into team_tick select * from public.team_start_run('7ea70000-0000-4000-8000-0000000000f1', '2026-11-21 13:00+00');
insert into tick select run_id, topic, doc, searches_per_run from team_tick;
select results_eq('select topic from tick', array['Team paused'], 'a one-off run starts');
select is(pg_temp.facts(),
  'normal 4 false - daily 1 ## Team paused' || chr(10) || 'No news yet. never',
  'a one-off run carries the same facts as a claim');
delete from team_tick;
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

select is((select hidden_reason from public.interests where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'),
  'spam', 'the owner sees why');

set local role anon;
select is((select count(*)::int from public.public_topics() c
           where c ->> 'id' = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 0,
  'a hidden topic is gone from the catalog');
select is(public.interest_by_slug('anna-test-public-00001'), null::jsonb, 'and from its link');
select is((select count(*)::int from public.public_topics() c
           where c ->> 'id' = '7ea70000-0000-4000-8000-0000000000d1'), 1,
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
select ok(not has_function_privilege('authenticated', 'public.run_facts(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.run_facts(uuid)', 'execute'),
  'readers cannot read a run''s facts (any interest''s doc and history)');
select ok(not has_function_privilege('authenticated', 'public.team_start_run(uuid, timestamptz)', 'execute'),
  'readers cannot start team runs');

select * from finish();
rollback;
