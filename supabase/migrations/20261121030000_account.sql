-- Deleting an account, and the daily cleanup
-- (plan/research/fable-review.md items 6 and 19).
--
-- Delete account is one Worker route (POST /account/delete): it verifies the
-- reader's JWT, calls prepare_account_delete, then deletes the auth user with
-- the service role. Every table that holds a user id cascades from auth.users
-- (runs.requested_by is set null), so nothing names the user afterwards.
-- Soft-deleting the topics first is what tells their followers: each gets a
-- "deleted" notice with a copy they may host themselves (none for a hidden
-- topic, which is not listed).

create function public.prepare_account_delete(p_user uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.interests set deleted_at = now()
  where owner_id = p_user and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Daily: runs created over 30 days ago go, except queued or running ones and
-- each interest's latest ready run; queued pushes over a day old go too.
-- Returns the number of runs deleted.
create function public.cleanup_runs(p_now timestamptz default now()) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.runs r
  where r.created_at < p_now - interval '30 days'
    and r.status in ('ready', 'failed')
    and r.id is distinct from (
      select l.id from public.runs l
      where l.interest_id = r.interest_id and l.status = 'ready'
      order by l.finished_at desc nulls last, l.created_at desc
      limit 1);
  get diagnostics v_count = row_count;

  delete from public.outbox where created_at < p_now - interval '1 day';
  return v_count;
end;
$$;

revoke execute on function public.prepare_account_delete(uuid), public.cleanup_runs(timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_account_delete(uuid), public.cleanup_runs(timestamptz)
  to service_role;
