-- Enforce plans.max_interests in the database (20261120030000_chat.sql added the
-- column, but only the chat's planChatChanges checked it). Without this a reader
-- could insert interests directly, or two chat turns at once could pass the cap.
-- allowance() now also counts used.interests: the reader's own live interests,
-- any cadence; public ones do not count, as for the cadence limits.

create or replace function public.allowance(p_user uuid default auth.uid()) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_plan_id text;
  v_tz text;
  v_day_start timestamptz;
begin
  if p_user is null then
    raise exception 'allowance: no user' using errcode = '22004';
  end if;
  if auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'allowance: not your account' using errcode = '42501';
  end if;

  select pr.plan, pr.timezone into v_plan_id, v_tz
  from public.profiles pr where pr.id = p_user;
  v_tz := coalesce(v_tz, 'UTC');
  select * into v_plan from public.plans where id = coalesce(v_plan_id, 'free');

  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return jsonb_build_object(
    'plan', v_plan.id,
    'used', jsonb_build_object(
      'interests', (
        select count(*) from public.interests
        where owner_id = p_user and visibility <> 'public' and deleted_at is null),
      'daily_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'daily'
          and visibility <> 'public' and deleted_at is null),
      'weekly_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'weekly'
          and visibility <> 'public' and deleted_at is null),
      'on_demand_runs_today', (
        select count(*) from public.runs
        where requested_by = p_user and created_at >= v_day_start),
      'chat_turns_today', (
        select count(*) from public.chat_turns
        where user_id = p_user and created_at >= v_day_start)
    ),
    'limits', to_jsonb(v_plan) - 'id'
  );
end;
$$;

create or replace function public.check_interest_allowance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
  v_counts boolean;
  v_counted_before boolean;
  v_listed boolean;
  v_listed_before boolean;
begin
  -- Serialise quota checks per owner so two inserts cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('interest-quota:' || new.owner_id::text));
  v_allow := public.allowance(new.owner_id);

  if tg_op = 'INSERT' or new.doc is distinct from old.doc then
    if char_length(new.doc) > (v_allow -> 'limits' ->> 'max_doc_chars')::int then
      raise exception 'quota: intent doc is longer than % characters',
        v_allow -> 'limits' ->> 'max_doc_chars'
        using errcode = 'P0001', hint = 'max_doc_chars';
    end if;
  end if;

  -- The list cap: checked only when the row joins the owner's list.
  v_listed := new.visibility <> 'public' and new.deleted_at is null;
  v_listed_before := tg_op = 'UPDATE' and old.owner_id = new.owner_id
              and old.visibility <> 'public' and old.deleted_at is null;
  if v_listed and not v_listed_before then
    if (v_allow -> 'used' ->> 'interests')::int
       >= (v_allow -> 'limits' ->> 'max_interests')::int then
      raise exception 'quota: % of % interests used',
        v_allow -> 'used' ->> 'interests',
        v_allow -> 'limits' ->> 'max_interests'
        using errcode = 'P0001', hint = 'max_interests';
    end if;
  end if;

  v_counts := new.cadence in ('daily', 'weekly')
              and new.visibility <> 'public' and new.deleted_at is null;
  v_counted_before := tg_op = 'UPDATE' and old.cadence = new.cadence
              and old.visibility <> 'public' and old.deleted_at is null;

  -- Check only when the row starts to count, so lowering a limit never blocks
  -- unrelated edits to interests the user already has.
  if v_counts and not v_counted_before then
    -- allowance() counts the stored rows; on update this row is not among them
    -- for the new cadence, on insert it is not stored yet.
    if (v_allow -> 'used' ->> (new.cadence || '_interests'))::int
       >= (v_allow -> 'limits' ->> (new.cadence || '_interests'))::int then
      raise exception 'quota: % of % % interests used',
        v_allow -> 'used' ->> (new.cadence || '_interests'),
        v_allow -> 'limits' ->> (new.cadence || '_interests'),
        new.cadence
        using errcode = 'P0001', hint = new.cadence || '_interests';
    end if;
  end if;

  return new;
end;
$$;
