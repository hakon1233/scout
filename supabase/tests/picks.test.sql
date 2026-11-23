-- Picks tests: a reader reads only their own picks and dismissals; my_picks
-- drops owned, followed, dismissed and unlisted topics; a profile change asks
-- for a refresh at most once per 24 hours; the Monday refresh holds the weekly
-- push until finish_picks, or 12 hours; readers over their cap are skipped and
-- picks calls count against the caps. Run with `pnpm test:rls` against
-- `supabase start`, or `pnpm test:rls:hosted`. Rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project has its own catalog; hide it here (rolled back) so only this
-- file's topics count.
update public.interests set hidden_at = now() where visibility = 'public' and hidden_at is null;
-- Its readers' activity makes them active readers; drop it too.
delete from public.usage_events;
delete from public.story_marks;
delete from public.follows;
delete from public.reader_picks;
delete from public.pick_runs;

-- Pia reads; Tor hosts public topics; Una is another reader.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'pia@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'tor@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-0000000000e3', 'una@example.test', 'authenticated', 'authenticated');
update public.profiles set is_team = true where id = 'bbbbbbbb-0000-0000-0000-0000000000e2';
update public.profiles set liked_tags = '{outdoors}' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence, tags, published_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'Fjord kayaking', 'Trips on the fjords.', 'public', 'f1f1f1f1f1f1f1f1f1f1f1f1', 'off', '{outdoors,travel}', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'AI chips', 'Chips.', 'public', 'f2f2f2f2f2f2f2f2f2f2f2f2', 'off', '{ai,tech}', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'Kayak racing', 'Races.', 'public', 'f3f3f3f3f3f3f3f3f3f3f3f3', 'off', '{sports}', now()),
  ('00000000-0000-0000-0000-0000000000f4', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'Link only', 'Shared.', 'shared', 'f4f4f4f4f4f4f4f4f4f4f4f4', 'off', '{outdoors}', null),
  ('00000000-0000-0000-0000-0000000000f5', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Pia''s own', 'Mine.', 'public', 'f5f5f5f5f5f5f5f5f5f5f5f5', 'off', '{outdoors}', now()),
  ('00000000-0000-0000-0000-0000000000f6', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'Ski touring', 'Snow.', 'public', 'f6f6f6f6f6f6f6f6f6f6f6f6', 'off', '{outdoors}', now());

-- Pia follows Ski touring (recently, so she is an active reader).
insert into public.follows (user_id, interest_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f6');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'https://fcm.googleapis.com/fcm/send/pia-phone', 'k', 'a');

-- The profile update above asked for a refresh.
select ok((select requested_at is not null from public.reader_picks
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'),
  'a profile change asks for a refresh');
update public.profiles set liked_tags = '{outdoors}' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
update public.reader_picks set requested_at = null where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
update public.profiles set liked_tags = '{outdoors}' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
select ok((select requested_at is null from public.reader_picks
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'),
  'an update that changes nothing asks for nothing');
update public.profiles set role = 'Nurse' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';

-- ---------------------------------------------------------------------------
-- claim_picks: the input, and the 24-hour debounce
-- ---------------------------------------------------------------------------

create temp table claimed as select public.claim_picks(5, now()) as c;

select is((select jsonb_array_length(c) from claimed), 1, 'one reader due');
select is((select c -> 0 ->> 'kind' from claimed), 'profile', 'a profile refresh');
select is((select c -> 0 -> 'input' -> 'profile' ->> 'role' from claimed), 'Nurse',
  'the input carries the profile');
select results_eq(
  $$select e ->> 'title' from claimed, jsonb_array_elements(c -> 0 -> 'input' -> 'candidates') e$$,
  array['Fjord kayaking', 'AI chips', 'Kayak racing'],
  'candidates: public, listed, not owned or followed; tag overlap first');
select ok((select c -> 0 -> 'input' -> 'reading' from claimed)
          @> '[{"title": "Pia''s own", "how": "own"}, {"title": "Ski touring", "how": "follow"}]',
  'the input names what the reader already has, and which they own or follow');

select is(jsonb_array_length(public.claim_picks(5, now())), 0, 'claimed readers are not claimed twice');
update public.profiles set role = 'Doctor' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
select is(jsonb_array_length(public.claim_picks(5, now() + interval '23 hours')), 0,
  'a second profile change waits 24 hours');
select is(jsonb_array_length(public.claim_picks(5, now() + interval '25 hours')), 1,
  'then it is claimed');
select is((select count(*)::int from public.pick_runs
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), 2, 'one pick_runs row per claim');

-- ---------------------------------------------------------------------------
-- finish_picks keeps only pickable topics
-- ---------------------------------------------------------------------------

select is(public.finish_picks('aaaaaaaa-0000-0000-0000-0000000000e1',
  (select (c -> 0 ->> 'run_id')::bigint from claimed),
  '[{"interest_id":"00000000-0000-0000-0000-0000000000f1","reason":"You like the outdoors."},
    {"interest_id":"00000000-0000-0000-0000-0000000000f5","reason":"Own."},
    {"interest_id":"00000000-0000-0000-0000-0000000000f4","reason":"Link only."},
    {"interest_id":"00000000-0000-0000-0000-0000000000f1","reason":"Twice."},
    {"interest_id":"not-a-uuid","reason":"Bad."},
    {"interest_id":"00000000-0000-0000-0000-0000000000f3","reason":"Kayaks, faster."},
    {"interest_id":"00000000-0000-0000-0000-0000000000f2","reason":"Popular."}]'::jsonb,
  0.0007, null, public.picks_version(), 4000, 300), 3, 'owned, link-only, repeated and unknown picks are dropped');
select is((select cost_usd from public.pick_runs
           where id = (select (c -> 0 ->> 'run_id')::bigint from claimed)), 0.0007,
  'the cost is recorded');
select is((select input_tokens || ' ' || output_tokens from public.pick_runs
           where id = (select (c -> 0 ->> 'run_id')::bigint from claimed)), '4000 300',
  'and the tokens the call used');
select is((select version from public.reader_picks
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), public.picks_version(),
  'picks carry the version that made them');
select is(public.finish_picks('aaaaaaaa-0000-0000-0000-0000000000e1', 0, null, 0, 'timeout'), 0,
  'a failed call keeps the cached picks');

-- ---------------------------------------------------------------------------
-- The reader's side
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select results_eq(
  $$select title, reason, owner_name, team from public.my_picks()$$,
  $$values ('Fjord kayaking'::text, 'You like the outdoors.'::text, 'Scout team'::text, true),
           ('Kayak racing', 'Kayaks, faster.', 'Scout team', true),
           ('AI chips', 'Popular.', 'Scout team', true)$$,
  'my_picks: best first, with reason and owner');

select lives_ok($$ select public.dismiss_pick('00000000-0000-0000-0000-0000000000f3') $$, 'dismiss');
select lives_ok($$ select public.dismiss_pick('00000000-0000-0000-0000-0000000000f3') $$,
  'dismiss is idempotent');
reset role;
insert into public.follows (user_id, interest_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
select results_eq($$select title from public.my_picks()$$, array['Fjord kayaking'],
  'dismissed and followed topics drop out');
select ok((select public.my_picks_reader()) @> '{"profile": {"likedTags": ["outdoors"]},
          "reading": [{"title": "Ski touring", "how": "follow"}, {"title": "Pia''s own", "how": "own"}]}',
  'my_picks_reader: what a reason may cite about the reader');
select is((select public.my_picks_reader()) -> 'candidates', null, 'and no candidates');
select is((select count(*)::int from public.dismissed_picks), 1, 'a reader sees their dismissals');
select is((select count(*)::int from public.reader_picks), 1, 'a reader sees their picks row');
select throws_ok($$ select public.claim_picks(5) $$, '42501', null, 'readers cannot claim');
select throws_ok($$ select count(*) from public.pick_runs $$, '42501', null,
  'readers cannot read pick_runs');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is((select count(*)::int from public.reader_picks), 0, 'others'' picks are invisible');
select is((select count(*)::int from public.dismissed_picks), 0, 'others'' dismissals are invisible');
select is((select count(*)::int from public.my_picks()), 0, 'no picks yet');

reset role;

-- After the dismissal the candidates leave out Kayak racing too.
select results_eq(
  $$select e ->> 'title' from jsonb_array_elements(
      public.picks_input('aaaaaaaa-0000-0000-0000-0000000000e1') -> 'candidates') e$$,
  array['Fjord kayaking'], 'dismissed and followed topics are not candidates');

-- ---------------------------------------------------------------------------
-- Picks made by an older picks prompt are stale: never served, made again
-- ---------------------------------------------------------------------------

update public.reader_picks set version = public.picks_version() - 1,
  attempted_at = now() - interval '2 hours', requested_at = null, weekly_due_at = null
where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is((select count(*)::int from public.my_picks()), 0, 'stale picks are never served');
reset role;
create temp table stale as select public.claim_picks(5, now()) as c;
select is((select jsonb_array_length(c) from stale), 1, 'a stale reader is claimed on the next tick');
select is((select c -> 0 ->> 'kind' from stale), 'stale', 'as a stale refresh');
select is(jsonb_array_length(public.claim_picks(5, now() + interval '30 minutes')), 0,
  'a stale reader is retried at most once an hour');
select is(public.finish_picks('aaaaaaaa-0000-0000-0000-0000000000e1',
  (select (c -> 0 ->> 'run_id')::bigint from stale),
  '[{"interest_id":"00000000-0000-0000-0000-0000000000f1","reason":"Like ski touring."}]', 0.0007, null,
  public.picks_version() - 1), 1, 'an older worker''s picks are stored');
select is(jsonb_array_length(public.claim_picks(5, now() + interval '2 hours')), 1,
  'but stay stale');
select is(public.finish_picks('aaaaaaaa-0000-0000-0000-0000000000e1',
  (select max(id) from public.pick_runs), '[{"interest_id":"00000000-0000-0000-0000-0000000000f1","reason":"Like ski touring."}]',
  0.0007, null, public.picks_version()), 1, 'current picks are stored');
set local role authenticated;
select results_eq($$select title from public.my_picks()$$, array['Fjord kayaking'],
  'and served');
reset role;
select is(jsonb_array_length(public.claim_picks(5, now() + interval '4 hours')), 0,
  'and not claimed again');

-- ---------------------------------------------------------------------------
-- Monday: the weekly push waits for the refresh
-- ---------------------------------------------------------------------------

delete from public.follows where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'
  and interest_id = '00000000-0000-0000-0000-0000000000f2';
delete from public.pick_runs;
update public.reader_picks set attempted_at = null, requested_at = null;

select is(public.start_weekly_picks(now()), 1, 'only active readers are refreshed');
select is(public.queue_weekly_pushes(now()), 0, 'the weekly push waits for the refresh');

create temp table weekly as select public.claim_picks(5, now()) as c;
select is((select c -> 0 ->> 'kind' from weekly), 'weekly', 'a weekly refresh is claimed');
select is(public.finish_picks('aaaaaaaa-0000-0000-0000-0000000000e1',
  (select (c -> 0 ->> 'run_id')::bigint from weekly),
  '[{"interest_id":"00000000-0000-0000-0000-0000000000f2","reason":"New to you."}]', 0.0007, null,
  public.picks_version()),
  1, 'stored');
select is((select payload -> 'picks' from public.outbox
           where kind = 'weekly' and user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'),
  '[{"slug": "f2f2f2f2f2f2f2f2f2f2f2f2", "title": "AI chips"}]'::jsonb,
  'finish_picks sends the weekly push with the picks');
select is((select weekly_due_at from public.reader_picks
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), null, 'and clears the flag');

-- A refresh that never finishes: the push goes out with cached picks after 12 hours.
delete from public.outbox;
select public.start_weekly_picks(now() + interval '1 hour');
select is(jsonb_array_length(public.claim_picks(5, now() + interval '1 hour')), 1, 'claimed');
select is(jsonb_array_length(public.claim_picks(5, now() + interval '14 hours')), 0, 'not again');
select is((select count(*)::int from public.outbox where kind = 'weekly'), 1,
  'after 12 hours the push goes out with the cached picks');

-- ---------------------------------------------------------------------------
-- Spend caps
-- ---------------------------------------------------------------------------

delete from public.outbox;
delete from public.pick_runs;
insert into public.pick_runs (user_id, kind, cost_usd) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'profile', 0.50);
select ok(not public.user_spending_open('aaaaaaaa-0000-0000-0000-0000000000e1', now()),
  'picks calls count against the reader''s cap');
select ok(public.spend_today(now()) >= 0.50, 'and the global spend');
update public.reader_picks set attempted_at = null;
select public.start_weekly_picks(now());
select is(jsonb_array_length(public.claim_picks(5, now())), 0, 'a reader over their cap is skipped');
select is((select count(*)::int from public.outbox where kind = 'weekly'), 1,
  'their weekly push goes out with the cached picks');
select is((select picks from public.reader_picks
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1') -> 0 ->> 'reason',
  'New to you.', 'the cached picks stay');

delete from public.pick_runs;
update public.settings set paused = true;
update public.reader_picks set requested_at = now(), attempted_at = null;
select is(jsonb_array_length(public.claim_picks(5, now())), 0, 'nothing is claimed while spending is closed');

select * from finish();
rollback;
