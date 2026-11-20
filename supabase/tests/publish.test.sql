-- Publish tests: publish_start's owner, cap, rate and 24 h checks;
-- publish_finish's approve and refuse; set_topic_tags, which never unpublishes,
-- while a topic or doc edit still does. Run with `pnpm test:rls` against
-- `supabase start`, or `pnpm test:rls:hosted`. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'pia@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'per@example.test', 'authenticated', 'authenticated');
update public.profiles set display_name = 'Pia P' where id = 'aaaaaaaa-0000-0000-0000-0000000000f1';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence) values
  ('00000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Fjord kayaking', 'Trips and gear.', 'shared', 'b1b1b1b1b1b1b1b1b1b1b1b1', 'weekly'),
  ('00000000-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Ski touring', 'Avalanche reports.', 'private', null, 'weekly'),
  ('00000000-0000-0000-0000-0000000000b3', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Trail running', 'Races.', 'public', 'b3b3b3b3b3b3b3b3b3b3b3b3', 'off'),
  ('00000000-0000-0000-0000-0000000000b4', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'Climbing', 'Crags.', 'public', 'b4b4b4b4b4b4b4b4b4b4b4b4', 'off');

-- ---------------------------------------------------------------------------
-- publish_start
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.publish_start('bbbbbbbb-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1')$$,
  'P0002', null, 'only the owner can publish');
select throws_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b3')$$,
  '22023', null, 'a public topic cannot start another check');

create temp table chk on commit drop as
  select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1',
                              '00000000-0000-0000-0000-0000000000b1') as r;
select is((select r ->> 'title' from chk), 'Fjord kayaking', 'the check reads the title');
select is((select r ->> 'doc' from chk), 'Trips and gear.', 'and the intent doc');
select is((select r ->> 'displayName' from chk), 'Pia P', 'and the display name');
select is((select count(*)::int from public.publish_checks
           where interest_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'the check is recorded');

-- ---------------------------------------------------------------------------
-- publish_finish
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$select public.publish_finish('bbbbbbbb-0000-0000-0000-0000000000f2', %s, true, '{ai}', null)$$,
         (select r ->> 'checkId' from chk)),
  'P0002', null, 'another user cannot finish the check');

select is(
  public.publish_finish('aaaaaaaa-0000-0000-0000-0000000000f1', (select (r ->> 'checkId')::bigint from chk),
                        true, array['Outdoors', 'travel', 'outdoors'], null),
  'b1b1b1b1b1b1b1b1b1b1b1b1', 'an approve returns the share slug');
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  'public', 'and makes the topic public');
select is((select tags from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  array['outdoors', 'travel'], 'with the normalised tags');
select ok((select published_at is not null from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  'and stamps published_at');
select throws_ok(
  format($$select public.publish_finish('aaaaaaaa-0000-0000-0000-0000000000f1', %s, true, '{ai}', null)$$,
         (select r ->> 'checkId' from chk)),
  'P0002', null, 'a check finishes once');

-- Three public now: the fourth is refused before any check.
select throws_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2')$$,
  'P0001', null, 'a fourth public topic is over the cap');

-- A refuse records the reason and changes nothing.
update public.interests set visibility = 'shared' where id = '00000000-0000-0000-0000-0000000000b4';
update public.interests set left_public_at = null where id = '00000000-0000-0000-0000-0000000000b4';
select is(
  public.publish_finish('aaaaaaaa-0000-0000-0000-0000000000f1',
    (public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2') ->> 'checkId')::bigint,
    false, null, 'Names a private person.'),
  null, 'a refuse returns null');
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-0000000000b2'),
  'private', 'and leaves the topic as it was');
select is((select reason from public.publish_checks where outcome = 'refused'),
  'Names a private person.', 'and keeps the reason');

-- A doc edit during the check: the approve is refused.
create temp table chk2 on commit drop as
  select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1',
                              '00000000-0000-0000-0000-0000000000b2') as r;
update public.interests set doc = 'Something else.' where id = '00000000-0000-0000-0000-0000000000b2';
select throws_ok(
  format($$select public.publish_finish('aaaaaaaa-0000-0000-0000-0000000000f1', %s, true, '{ai}', null)$$,
         (select r ->> 'checkId' from chk2)),
  '40001', null, 'a topic edited during its check is not published');

-- ---------------------------------------------------------------------------
-- Rate and the 24 h wait
-- ---------------------------------------------------------------------------

-- b4 just left public (above), so it waits 24 h.
update public.interests set left_public_at = now() - interval '1 hour'
where id = '00000000-0000-0000-0000-0000000000b4';
select throws_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b4')$$,
  'P0001', null, 'a topic that left public an hour ago waits');
update public.interests set left_public_at = now() - interval '25 hours'
where id = '00000000-0000-0000-0000-0000000000b4';
select lives_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b4')$$,
  'after 24 hours it may go public again');

-- Four checks so far today; one more is the fifth, then none.
select lives_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2')$$,
  'the fifth check of the day runs');
select throws_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2')$$,
  'P0001', null, 'the sixth is refused');
update public.publish_checks set created_at = now() - interval '25 hours';
select lives_ok(
  $$select public.publish_start('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2')$$,
  'checks older than 24 hours do not count');

-- Leaving public stamps left_public_at, however it happens.
select ok((select left_public_at is not null from public.interests where id = '00000000-0000-0000-0000-0000000000b4'),
  'a public topic made shared is stamped');

-- ---------------------------------------------------------------------------
-- Tags: owners edit them, it never unpublishes; topic and doc edits do
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000f1","role":"authenticated"}', true);

select is(
  public.set_topic_tags('00000000-0000-0000-0000-0000000000b1', array[' AI ', 'climate']),
  array['ai', 'climate'], 'an owner sets tags');
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  'public', 'a tag edit keeps the topic public');
select throws_ok(
  $$select public.set_topic_tags('00000000-0000-0000-0000-0000000000b1', array['a','bb','cc','dd','ee','ff'])$$,
  '22023', null, 'a tag of one letter is refused');
select throws_ok(
  $$select public.set_topic_tags('00000000-0000-0000-0000-0000000000b1', array['aa','bb','cc','dd','ee','ff'])$$,
  '22023', null, 'six tags are refused');
select throws_ok(
  $$select public.set_topic_tags('00000000-0000-0000-0000-0000000000b1', array['no spaces'])$$,
  '22023', null, 'a tag with a space is refused');
select throws_ok(
  $$update public.interests set tags = '{ai}' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', null, 'tags are set only through set_topic_tags');

select lives_ok(
  $$update public.interests set doc = 'New doc.' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'an owner edits the doc');
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  'shared', 'a doc edit drops a public topic to shared');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_topic_tags('00000000-0000-0000-0000-0000000000b3', array['ai'])$$,
  'P0002', null, 'another reader cannot set the tags');
select is((select count(*)::int from public.publish_checks), 0, 'readers do not see publish checks');

reset role;

-- ---------------------------------------------------------------------------
-- Publish checks count against the per-user and global spend caps
-- ---------------------------------------------------------------------------

create temp table spend_before as
select public.user_spend_since('bbbbbbbb-0000-0000-0000-0000000000f2', now() - interval '24 hours') as mine,
       public.spend_today(now()) as total;
insert into public.publish_checks (user_id, interest_id, text_hash, outcome, cost_usd, finished_at)
values ('bbbbbbbb-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', 'h', 'refused', 0.40, now());
select is(
  public.user_spend_since('bbbbbbbb-0000-0000-0000-0000000000f2', now() - interval '24 hours')
    - (select mine from spend_before),
  0.40::numeric, 'a publish check counts toward the reader''s spend');
select is(public.spend_today(now()) - (select total from spend_before),
  0.40::numeric, 'and toward the global spend');

select * from finish();
rollback;
