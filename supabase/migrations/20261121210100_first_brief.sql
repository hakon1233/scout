-- A new scheduled topic gets its first brief at once (UT-023). An interest that
-- has never had a run is due now, dated its latest slot even though that slot
-- is before it was made, so the next slot still runs. It is a scheduled run
-- (requested_by null): it counts toward runs_per_day and the spend caps like
-- any other, never toward the reader's Run now allowance. Otherwise unchanged
-- from 20261121070000_team_runner.

create or replace function public.due_interests(p_now timestamptz)
returns table (interest_id uuid, slot timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select i.id, s.slot
  from public.interests i
  left join public.profiles pr on pr.id = i.owner_id
  cross join lateral (
    select public.last_run_slot(i.cadence, i.run_at, i.run_weekday,
                                coalesce(pr.timezone, 'UTC'), p_now) as slot
  ) s
  where i.cadence in ('daily', 'weekly') and i.deleted_at is null
    and i.hidden_at is null and not i.paused
    and (s.slot >= i.created_at
         or not exists (select 1 from public.runs r0 where r0.interest_id = i.id))
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null
        and r.scheduled_for > s.slot - case i.cadence when 'daily' then interval '20 hours'
                                                      else interval '6 days' end)
$$;
