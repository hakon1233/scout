-- Profile and payments tests (20261121130000_profile.sql,
-- 20261121140000_payments.sql): is_reserved_name and liked_tags_ok case by
-- case, and the subscriptions table's RLS. browse.test.sql covers a reader
-- filling in their profile. Run with `pnpm test:sql profile`. Rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Reserved names
-- ---------------------------------------------------------------------------

select results_eq(
  $$select n from unnest(array['Scout', 'scout team', 'Scout-Team', 'THE SCOUT', 'SC0UT',
      '$cout', 'admin.', 'Administrator', 'mod', 'Moderator HQ', 'Scout official',
      'team scout', 'Official Scout', 'scout_app', 'Scout support']) n
    where not public.is_reserved_name(n)$$,
  array[]::text[], 'names that read as Scout, its team or an admin are reserved');
select results_eq(
  $$select n from unnest(array['Scouting for birds', 'Boy scout', 'Scout fan', 'Admiral',
      'Modern', 'Cato', 'Åse', '']) n
    where public.is_reserved_name(n)$$,
  array[]::text[], 'other names, including ones that only contain scout, are free');
select is(public.is_reserved_name(null), false, 'no name is not reserved');

-- ---------------------------------------------------------------------------
-- Liked tags
-- ---------------------------------------------------------------------------

select is(public.liked_tags_ok('{}'), true, 'no liked tags');
select is(public.liked_tags_ok('{health,norway,æøå,open-source}'), true, 'tags in the pattern');
select is(
  public.liked_tags_ok(array(select 't' || n from generate_series(1, 20) n)), true, '20 tags');
select is(
  public.liked_tags_ok(array(select 't' || n from generate_series(1, 21) n)), false, 'not 21');
select is(public.liked_tags_ok('{Health}'), false, 'lower case only');
select is(public.liked_tags_ok('{x}'), false, 'two letters at least');
select is(public.liked_tags_ok(array[repeat('x', 25)]), false, '24 at most');

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000a7', 'pia@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000a8', 'ola@example.test', 'authenticated', 'authenticated');
insert into public.subscriptions (user_id, provider, provider_ref, status, plan) values
  ('aaaaaaaa-0000-0000-0000-0000000000a7', 'vipps', 'agr_pia', 'active', 'plus'),
  ('bbbbbbbb-0000-0000-0000-0000000000a8', 'stripe', 'sub_ola', 'pending', 'plus');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
select results_eq($$select provider_ref from public.subscriptions$$, array['agr_pia'],
  'a reader reads their own subscription only');
select throws_ok($$update public.subscriptions set status = 'active', plan = 'plus'$$,
  '42501', null, 'and cannot change it');
select throws_ok($$delete from public.subscriptions$$, '42501', null, 'or delete it');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.subscriptions$$, '42501', null,
  'signed out, nothing');
reset role;

select * from finish();
rollback;
