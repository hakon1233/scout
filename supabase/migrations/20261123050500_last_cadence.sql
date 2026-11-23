-- A paused topic remembers the cadence it had, so Resume in Settings can give
-- it back (src/components/hosted/useHostedHome.ts, resumeSlot). Pausing is the
-- reader's cadence 'off'; the plan's daily and weekly caps already count only
-- topics that are not off (allowance, check_interest_allowance), so pausing
-- frees a slot at once and resuming takes one only when it is free.
--
-- Set only by the trigger: readers have no grant to write it. Topics paused
-- before this migration remember nothing (null); Resume then tries weekly first.

alter table public.interests
  add column last_cadence text check (last_cadence in ('daily', 'weekly'));

create function public.remember_cadence() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cadence = 'off' and old.cadence in ('daily', 'weekly') then
    new.last_cadence := old.cadence;
  end if;
  return new;
end;
$$;

-- A trigger function: no one calls it directly.
revoke execute on function public.remember_cadence() from public, anon, authenticated;

create trigger interests_remember_cadence
  before update of cadence on public.interests
  for each row execute function public.remember_cadence();
