-- Every new account gets a profile row (plan free, time zone UTC), so code that
-- reads profiles never meets a signed-in user without one. allowance() still
-- treats a missing row as free, for safety.

create function public.create_profile_for_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Runs only as the trigger, never as a call from a client.
revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;

create trigger create_profile_on_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Accounts made before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
