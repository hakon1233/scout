-- Sharing tests: set_visibility, follow and unfollow, interest_by_slug signed out,
-- stopped_sharing notices on private and on delete, and host_copy within limits.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end. `set local role` + request.jwt.claims act as
-- a reader; `reset role` returns to postgres for setup and checks.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project holds real rows (the starter catalog, real runs and spend), so
-- reads are scoped to this file's fixtures (ids starting 00000000-) and spend is
-- measured from a baseline taken before any fixture costs.

-- ---------------------------------------------------------------------------
-- Setup (as postgres): Hana hosts (admin), Ben follows, Cleo is a plain reader.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'hana@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'ben@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'cleo@example.test', 'authenticated', 'authenticated');
update public.profiles set is_admin = true where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

insert into public.interests (id, owner_id, topic, doc, cadence) values
  ('00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Trondheim events', 'Concerts and talks in Trondheim.', 'weekly'),
  ('00000000-0000-0000-0000-00000000a002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Heat pumps', 'Nordic heat pump policy.', 'off'),
  ('00000000-0000-0000-0000-00000000c001', 'cccccccc-0000-0000-0000-00000000000c',
   'Cleo bikes', '', 'off');

insert into public.runs (interest_id, status, section_md, finished_at) values
  ('00000000-0000-0000-0000-00000000a001', 'ready', '## Old', now() - interval '8 days'),
  ('00000000-0000-0000-0000-00000000a001', 'ready', '## Latest', now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- set_visibility
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select ok(char_length(public.set_visibility('00000000-0000-0000-0000-00000000a001', 'shared')) >= 20,
  'sharing mints a link slug');
select is(public.set_visibility('00000000-0000-0000-0000-00000000a001', 'shared'),
  (select share_slug from public.interests where id = '00000000-0000-0000-0000-00000000a001'),
  'sharing again keeps the same slug');
select ok(char_length(public.set_visibility('00000000-0000-0000-0000-00000000a002', 'public')) >= 20,
  'an admin may make an interest public');
select throws_ok($$ select public.set_visibility('00000000-0000-0000-0000-00000000c001', 'shared') $$,
  'P0002', null, 'no one sets the visibility of someone else''s interest');
select throws_ok($$ select public.set_visibility('00000000-0000-0000-0000-00000000a001', 'secret') $$,
  '22023', null, 'an unknown visibility is refused');
select throws_ok($$ update public.interests set visibility = 'public'
  where id = '00000000-0000-0000-0000-00000000a001' $$,
  '42501', null, 'visibility has no column grant: only set_visibility changes it');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select public.set_visibility('00000000-0000-0000-0000-00000000c001', 'public') $$,
  '42501', null, 'a reader who is not an admin cannot make an interest public');
select lives_ok($$ select public.set_visibility('00000000-0000-0000-0000-00000000c001', 'shared') $$,
  'any reader may share by link');
select is(public.set_visibility('00000000-0000-0000-0000-00000000c001', 'private'), null,
  'making it private clears the slug');

reset role;
create temp table slugs on commit drop as
  select id, share_slug from public.interests where share_slug is not null;
grant select on slugs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed out: a link shows the interest and its latest brief
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(public.interest_by_slug((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a001')) ->> 'topic',
  'Trondheim events', 'a signed-out visitor reads a shared interest by its link');
select is(public.interest_by_slug((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a001')) -> 'run' ->> 'section_md',
  '## Latest', 'the link shows the latest ready run');
select is((public.interest_by_slug((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a002')) ->> 'visibility'),
  'public', 'a signed-out visitor reads a public interest by its link');
select is(public.interest_by_slug('no-such-slug-aaaaaaaaaaaa'), null, 'an unknown link shows nothing');
select results_eq('select topic from public.interests where id::text like ''00000000-%'' order by topic', array['Heat pumps'],
  'signed out, the table still shows only public interests');
select ok(not has_function_privilege('anon', 'public.follow(text)', 'execute'),
  'a signed-out visitor cannot follow');

-- ---------------------------------------------------------------------------
-- follow and unfollow
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(public.follow((select share_slug from slugs where id = '00000000-0000-0000-0000-00000000a001')),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'a reader follows a shared interest from its link');
select lives_ok($$ select public.follow((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a001')) $$, 'following twice is fine');
select lives_ok($$ select public.follow((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a002')) $$, 'a reader follows a public interest');
select results_eq('select interest_id from public.follows order by interest_id',
  array['00000000-0000-0000-0000-00000000a001'::uuid, '00000000-0000-0000-0000-00000000a002'::uuid],
  'the follower sees both follows, once each');
select results_eq($$select topic from public.interests where id::text like '00000000-%' order by topic$$,
  array['Heat pumps', 'Trondheim events'], 'the follower reads both interests');
select is((select count(*)::int from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000a001'),
  2, 'the follower reads the host''s runs');
select is((public.allowance() -> 'used' ->> 'interests')::int, 0,
  'following costs the follower nothing');
select ok((public.interest_by_slug((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a001')) ->> 'following')::boolean,
  'the link knows the reader follows it');
select throws_ok($$ select public.follow('no-such-slug-aaaaaaaaaaaa') $$, 'P0002', null,
  'an unknown link cannot be followed');

delete from public.follows where interest_id = '00000000-0000-0000-0000-00000000a002';
select is((select count(*)::int from public.follows), 1, 'a reader unfollows');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.follow((select share_slug from slugs where id = '00000000-0000-0000-0000-00000000a001')),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'the host following their own link is a no-op');
select ok((public.interest_by_slug((select share_slug from slugs
    where id = '00000000-0000-0000-0000-00000000a001')) ->> 'owned')::boolean,
  'the link knows the host owns it');
reset role;
select is((select count(*)::int from public.follows
    where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0, 'the host has no follow row');

-- ---------------------------------------------------------------------------
-- Stopped sharing: private, then delete
-- ---------------------------------------------------------------------------

insert into public.follows (user_id, interest_id) values
  ('cccccccc-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000a001'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a002'),
  ('cccccccc-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000a002');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.set_visibility('00000000-0000-0000-0000-00000000a001', 'private'), null,
  'the host makes the shared interest private');
update public.interests set deleted_at = now() where id = '00000000-0000-0000-0000-00000000a002';
reset role;

select is((select count(*)::int from public.follows), 0, 'every follow ended');
select results_eq($$
  select user_id::text || ' ' || (payload ->> 'topic') from public.notifications
  where kind = 'stopped_sharing' order by 1 $$,
  array['bbbbbbbb-0000-0000-0000-00000000000b Heat pumps',
        'bbbbbbbb-0000-0000-0000-00000000000b Trondheim events',
        'cccccccc-0000-0000-0000-00000000000c Heat pumps',
        'cccccccc-0000-0000-0000-00000000000c Trondheim events'],
  'each follower got one notice per interest, on private and on delete');
select is((select payload ->> 'doc' from public.notifications
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and payload ->> 'topic' = 'Trondheim events'),
  'Concerts and talks in Trondheim.', 'the notice keeps the intent doc');

update public.interests set deleted_at = null where id = '00000000-0000-0000-0000-00000000a002';
update public.interests set doc = 'edited' where id = '00000000-0000-0000-0000-00000000a002';
select is((select count(*)::int from public.notifications), 4,
  'restoring or editing sends no new notice');

-- ---------------------------------------------------------------------------
-- host_copy: within the reader's limits
-- ---------------------------------------------------------------------------

create temp table notes on commit drop as
  select id, user_id, payload ->> 'topic' as topic from public.notifications;
grant select on notes to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is((select count(*)::int from public.notifications), 2, 'a reader sees only their notices');
select lives_ok($$ select public.host_copy((select id from notes
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and topic = 'Trondheim events')) $$,
  'a follower hosts the interest themselves');
select results_eq($$ select topic || ' ' || visibility || ' ' || cadence || ' ' || doc
    from public.interests where owner_id = 'bbbbbbbb-0000-0000-0000-00000000000b' $$,
  array['Trondheim events private off Concerts and talks in Trondheim.'],
  'the copy is their own private, paused interest with the same intent doc');
select isnt((select read_at from public.notifications where id = (select id from notes
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and topic = 'Trondheim events')), null,
  'the notice is marked read');
select throws_ok($$ select public.host_copy((select id from notes
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and topic = 'Trondheim events')) $$,
  'P0002', null, 'a notice is used once');
select throws_ok($$ select public.host_copy((select id from notes
    where user_id = 'cccccccc-0000-0000-0000-00000000000c' and topic = 'Heat pumps')) $$,
  'P0002', null, 'no one uses someone else''s notice');

reset role;
update public.plans set max_interests = 1 where id = 'free';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select public.host_copy((select id from notes
    where user_id = 'cccccccc-0000-0000-0000-00000000000c' and topic = 'Heat pumps')) $$,
  'P0001', null, 'a copy past the reader''s interest cap fails');
select is((select read_at from public.notifications where id = (select id from notes
    where user_id = 'cccccccc-0000-0000-0000-00000000000c' and topic = 'Heat pumps')), null,
  'a failed copy leaves the notice unread');
reset role;
update public.plans set max_interests = 15 where id = 'free';

select * from finish();
rollback;
