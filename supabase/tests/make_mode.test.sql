-- Make mode: the mode and "already sent" columns, the make_on switch on
-- scheduling and claiming, the memory a ready make run adds to, and the setup
-- chat setting a topic's mode. Run with `pnpm test:sql`, `pnpm test:rls` or
-- `pnpm test:rls:hosted`. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'mia@example.test', 'authenticated', 'authenticated');
update public.plans set daily_interests = 2 where id = 'plus';
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-0000000000f1';

insert into public.interests (id, owner_id, topic, cadence, run_at, run_weekday, created_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Mia news', 'daily', '07:00', 1, '2030-03-01'),
  ('00000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Bedtime story', 'daily', '07:00', 1, '2030-03-01');

create temp table tick (run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean, evergreen boolean,
  search_locale text, brief_language text, prior jsonb, cadence text,
  last_story_at timestamptz, mode text, sent_keys text[]);

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

select is((select make_on from public.settings), false, 'make mode starts switched off');
select is((select mode from public.interests where id = '00000000-0000-0000-0000-0000000000f1'),
  'news', 'a topic is news by default');
select is((select sent_keys from public.interests where id = '00000000-0000-0000-0000-0000000000f1'),
  '{}'::text[], 'and has sent nothing');
select throws_ok($$update public.interests set mode = 'poem'
    where id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23514', null, 'a mode is news or make');
update public.interests set mode = 'make', sent_keys = '{"The Owl Who Lost Her Hoot"}'
where id = '00000000-0000-0000-0000-0000000000f2';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select throws_ok($$update public.interests set mode = 'news'
    where id = '00000000-0000-0000-0000-0000000000f2'$$,
  '42501', null, 'a reader cannot set the mode directly');
select throws_ok($$update public.interests set sent_keys = '{}'
    where id = '00000000-0000-0000-0000-0000000000f2'$$,
  '42501', null, 'nor the "already sent" list');
select is((select mode from public.interests where id = '00000000-0000-0000-0000-0000000000f2'),
  'make', 'but can read it');
reset role;

-- ---------------------------------------------------------------------------
-- The switch: off, make topics never run
-- ---------------------------------------------------------------------------

insert into tick select * from public.claim_runs(10, '2030-03-02 12:00+00');
select results_eq('select topic from tick', array['Mia news'],
  'while make mode is off only the news topic runs');
select is((select count(*)::int from public.runs
           where interest_id = '00000000-0000-0000-0000-0000000000f2'), 0,
  'the make topic is not even queued');

-- A queued make run (a Run now) fails while the switch is off.
insert into public.runs (interest_id, status, scheduled_for, requested_by) values
  ('00000000-0000-0000-0000-0000000000f2', 'queued', '2030-03-02 12:00+00',
   'aaaaaaaa-0000-0000-0000-0000000000f1');
delete from tick;
insert into tick select * from public.claim_runs(10, '2030-03-02 12:01+00');
select is((select count(*)::int from tick), 0, 'a queued make run is not claimed');
select is((select status || ': ' || error_msg from public.runs
           where interest_id = '00000000-0000-0000-0000-0000000000f2'),
  'failed: make mode is off', 'it fails, saying why');
delete from public.runs where interest_id = '00000000-0000-0000-0000-0000000000f2';

-- ---------------------------------------------------------------------------
-- The switch: on, make topics run with their mode and memory
-- ---------------------------------------------------------------------------

update public.settings set make_on = true;
delete from tick;
insert into tick select * from public.claim_runs(10, '2030-03-02 12:02+00');
select results_eq('select topic, mode, sent_keys from tick',
  $$values ('Bedtime story'::text, 'make'::text, '{"The Owl Who Lost Her Hoot"}'::text[])$$,
  'with make mode on the make topic runs, carrying its mode and what it already sent');

select ok(public.finish_run((select run_id from tick),
  e'## Bedtime story\n\n- `2030-03-02` — The *Fox* Who Counted Stars\n  > Once upon a time.\n',
  '{"topic":"Bedtime story","status":"covered"}', 0, 0.01, null, '2030-03-02 12:03+00'),
  'a make run finishes like any other');
select is((select sent_keys from public.interests where id = '00000000-0000-0000-0000-0000000000f2'),
  '{"The Owl Who Lost Her Hoot","The Fox Who Counted Stars"}'::text[],
  'a ready make run adds its piece''s key to the memory');

-- The memory keeps the last 60.
update public.interests
set sent_keys = (select array_agg('Piece ' || n order by n) from generate_series(1, 60) n)
where id = '00000000-0000-0000-0000-0000000000f2';
insert into public.runs (id, interest_id, status, scheduled_for, started_at, attempts) values
  ('99999999-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', 'running',
   '2030-03-03 06:00+00', '2030-03-03 06:00+00', 1);
select ok(public.finish_run('99999999-0000-0000-0000-0000000000f2',
  e'## Bedtime story\n\n- `2030-03-03` — Piece 61\n  > Once.\n',
  '{"topic":"Bedtime story","status":"covered"}', 0, 0.01, null, '2030-03-03 06:01+00'),
  'another make run finishes');
select is((select cardinality(sent_keys) || ' ' || sent_keys[1] || ' ' || sent_keys[60]
           from public.interests where id = '00000000-0000-0000-0000-0000000000f2'),
  '60 Piece 2 Piece 61', 'the memory keeps the newest 60, oldest dropped');

-- A news run never touches the memory.
select is((select sent_keys from public.interests where id = '00000000-0000-0000-0000-0000000000f1'),
  '{}'::text[], 'a news topic keeps no memory');

-- ---------------------------------------------------------------------------
-- The setup chat sets the mode
-- ---------------------------------------------------------------------------

select lives_ok($$select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-0000000000f1',
  '{"id":"22222222-0000-0000-0000-0000000000f1","status":"ready","message":"m","reply":"r",
    "changes":[{"op":"create","interestId":"00000000-0000-0000-0000-0000000000f3",
                "topic":"Word of the day","doc":"One Norwegian word.","mode":"make"}]}',
  '{}', 0)$$, 'the chat creates a make topic');
select is((select mode from public.interests where id = '00000000-0000-0000-0000-0000000000f3'),
  'make', 'it is stored as make');
select lives_ok($$select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-0000000000f1',
  '{"id":"22222222-0000-0000-0000-0000000000f2","status":"ready","message":"m","reply":"r",
    "changes":[{"op":"update","interestId":"00000000-0000-0000-0000-0000000000f3",
                "doc":"Two Norwegian words."}]}',
  '{}', 0)$$, 'an update without a mode');
select is((select mode from public.interests where id = '00000000-0000-0000-0000-0000000000f3'),
  'make', 'keeps the mode');

select * from finish();
rollback;
