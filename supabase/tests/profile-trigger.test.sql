-- Sign-up makes a profile row. Run with `pnpm test:rls` against `supabase start`.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000003', 'cara@example.test', 'authenticated', 'authenticated');

select results_eq(
  $$select plan, timezone, is_admin from public.profiles
    where id = 'cccccccc-0000-0000-0000-000000000003'$$,
  $$values ('free'::text, 'UTC'::text, false)$$,
  'a new account gets a free profile in UTC, not admin');

select is(
  public.allowance('cccccccc-0000-0000-0000-000000000003') ->> 'plan', 'free',
  'allowance reads the new profile');

-- The new reader sees their own profile.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 1, 'the new reader reads their profile');
select throws_ok(
  $$select public.create_profile_for_new_user()$$, '42501', null,
  'a signed-in reader cannot call the trigger function');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select public.create_profile_for_new_user()$$, '42501', null,
  'a signed-out visitor cannot call the trigger function');
reset role;

-- Deleting the account removes the profile.
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003'),
  0, 'deleting the account deletes its profile');

select * from finish();
rollback;
