-- bump_exa_usage: atomic counter bump with daily cap.
-- Returns true when the bump succeeded (under cap), false when rate-limited.
-- Called only by edge functions running as service-role.
create or replace function public.bump_exa_usage(
  p_user_id uuid,
  p_day date,
  p_cap integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.usage_exa_daily (user_id, day, count)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day)
  do update set count = public.usage_exa_daily.count + 1
  where public.usage_exa_daily.count < p_cap
  returning count into v_count;

  if v_count is null then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.bump_exa_usage(uuid, date, integer) from public;
grant execute on function public.bump_exa_usage(uuid, date, integer) to service_role;
