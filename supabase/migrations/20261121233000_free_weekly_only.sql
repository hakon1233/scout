-- Free holds 3 weekly topics and no daily one (founder decision, 20 Nov).
-- Following public topics stays free and unlimited: one run serves every
-- follower. plans.ts and this table must agree; test/plans-parity.test.mjs
-- checks it.
--
-- A free reader's daily topic becomes weekly, so its next run is a weekly one
-- (on its run_weekday) and nothing is lost. Team accounts keep theirs. The
-- quota trigger is off for this one update: a reader who also holds three
-- weekly topics keeps all of them, as when any other limit is lowered (the
-- trigger checks a cap only when a row starts to count).

update public.plans set daily_interests = 0 where id = 'free';

alter table public.interests disable trigger interests_allowance;

update public.interests i set cadence = 'weekly'
where i.cadence = 'daily'
  and i.deleted_at is null
  and not exists (
    select 1 from public.profiles pr
    where pr.id = i.owner_id and (pr.plan <> 'free' or coalesce(pr.is_team, false)));

alter table public.interests enable trigger interests_allowance;
