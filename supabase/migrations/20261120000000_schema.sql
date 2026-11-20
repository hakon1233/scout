-- Scout hosted, Phase 1 schema (docs/HOSTED-PLAN.md section 2).
--
-- Deny by default, twice over:
--   1. anon and authenticated lose every table and function privilege, and get back
--      only the columns and calls listed at the end of this file;
--   2. RLS is on for every table, so a granted privilege still sees only the rows a
--      policy allows.
-- The service role (Edge Functions) bypasses RLS and keeps its grants.
--
-- A brief is a query, not a table: the latest ready run of each interest you own
-- or follow.

-- ---------------------------------------------------------------------------
-- Deny by default
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plans and settings: limits and global switches. Limits are read only
-- through allowance().
-- ---------------------------------------------------------------------------

create table public.plans (
  id text primary key,
  daily_interests integer not null check (daily_interests >= 0),
  weekly_interests integer not null check (weekly_interests >= 0),
  on_demand_runs_per_day integer not null check (on_demand_runs_per_day >= 0),
  chat_turns_per_day integer not null check (chat_turns_per_day >= 0),
  searches_per_run integer not null check (searches_per_run > 0),
  max_doc_chars integer not null check (max_doc_chars > 0)
);

-- Håkon, 20 Nov 2026: free starts at 1 daily + 3 weekly.
insert into public.plans
  (id, daily_interests, weekly_interests, on_demand_runs_per_day,
   chat_turns_per_day, searches_per_run, max_doc_chars)
values ('free', 1, 3, 3, 40, 5, 4000);

-- Exactly one row.
create table public.settings (
  id boolean primary key default true check (id),
  daily_ceiling_usd numeric(10, 2) not null default 10 check (daily_ceiling_usd >= 0),
  model text not null default 'claude-haiku-5-5',
  -- Kill switch: no new runs or chat turns while true.
  paused boolean not null default false
);

insert into public.settings default values;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- True when Postgres knows the time zone name. Marked immutable so a check
-- constraint can use it; the zone list only grows between Postgres releases.
create function public.is_time_zone(tz text) returns boolean
language plpgsql immutable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

-- The row is created on sign-up (task 3). allowance() treats a missing row as free.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references public.plans (id),
  timezone text not null default 'UTC' check (public.is_time_zone(timezone)),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Interests
-- ---------------------------------------------------------------------------

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 200),
  -- The intent doc. Its length limit is per plan (max_doc_chars), checked by trigger.
  doc text not null default '',
  cadence text not null default 'off' check (cadence in ('daily', 'weekly', 'off')),
  -- Local time in the owner's profile time zone.
  run_at time not null default '07:00',
  -- Weekly interests only: ISO day of week, 1 = Monday.
  run_weekday smallint not null default 1 check (run_weekday between 1 and 7),
  -- shared: anyone with the link may follow. public: set by an admin, in the
  -- catalog, readable signed out, runs on no one's quota.
  visibility text not null default 'private'
    check (visibility in ('private', 'shared', 'public')),
  share_slug text unique check (share_slug is null or char_length(share_slug) >= 20),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index interests_owner_idx on public.interests (owner_id);
create index interests_public_idx on public.interests (visibility) where visibility = 'public';

-- ---------------------------------------------------------------------------
-- Follows. Inserted only through the follow RPC (task 9).
-- ---------------------------------------------------------------------------

create table public.follows (
  user_id uuid not null references auth.users (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);

create index follows_interest_idx on public.follows (interest_id);

-- ---------------------------------------------------------------------------
-- Runs. One run = one interest = one function call. Written by the service role only.
-- ---------------------------------------------------------------------------

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid not null references public.interests (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed')),
  scheduled_for timestamptz not null default now(),
  -- Set for an on-demand run (counts against that user's on_demand_runs_per_day);
  -- null for a scheduled run.
  requested_by uuid references auth.users (id) on delete set null,
  section_md text,
  coverage jsonb,
  searches integer check (searches >= 0),
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  error_msg text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index runs_interest_idx on public.runs (interest_id, scheduled_for desc);
create index runs_requested_by_idx on public.runs (requested_by, created_at)
  where requested_by is not null;

-- Single flight: at most one queued or running run per interest.
create unique index runs_single_flight_idx on public.runs (interest_id)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Chat turns. Written by the chat function only.
-- ---------------------------------------------------------------------------

create table public.chat_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null,
  reply text,
  changes jsonb,
  -- Pending deletes and rewrite, held until the reader confirms.
  pending jsonb,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  error_msg text,
  created_at timestamptz not null default now()
);

create index chat_turns_user_idx on public.chat_turns (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications. Phase 1 kinds only.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('stopped_sharing', 'run_failed', 'over_quota')),
  -- A snapshot (topic and intent doc for stopped_sharing), so it outlives the interest.
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- allowance(user): the only place limits are read.
-- ---------------------------------------------------------------------------

-- Returns {plan, used, limits}. "Today" is the user's own calendar day.
-- Interests that are public, deleted or off do not count; following never counts.
-- A signed-in caller may ask only about themselves; the service role about anyone.
create function public.allowance(p_user uuid default auth.uid()) returns jsonb
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

-- ---------------------------------------------------------------------------
-- Interest quota trigger: cadence counts and intent doc length, via allowance().
-- ---------------------------------------------------------------------------

create function public.check_interest_allowance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
  v_counts boolean;
  v_counted_before boolean;
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

create trigger interests_allowance
  before insert or update of doc, cadence, visibility, deleted_at, owner_id
  on public.interests
  for each row execute function public.check_interest_allowance();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.interests enable row level security;
alter table public.follows enable row level security;
alter table public.runs enable row level security;
alter table public.chat_turns enable row level security;
alter table public.notifications enable row level security;

-- settings: no policies, no grants. Service role only.

create policy plans_read on public.plans
  for select to authenticated using (true);

create policy profiles_own_read on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Interests: the owner sees all of theirs (deleted ones too, for history).
-- Others see a live public interest, or a live shared one they follow.
create policy interests_owner_read on public.interests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy interests_public_read on public.interests
  for select to anon, authenticated
  using (visibility = 'public' and deleted_at is null);
create policy interests_follower_read on public.interests
  for select to authenticated
  using (
    visibility = 'shared' and deleted_at is null
    and exists (
      select 1 from public.follows f
      where f.interest_id = interests.id and f.user_id = (select auth.uid())));
create policy interests_owner_insert on public.interests
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy interests_owner_update on public.interests
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy follows_own_read on public.follows
  for select to authenticated using (user_id = (select auth.uid()));
create policy follows_own_delete on public.follows
  for delete to authenticated using (user_id = (select auth.uid()));

-- Runs: readable when the interest is (the subquery runs under interests' RLS).
create policy runs_read on public.runs
  for select to anon, authenticated
  using (exists (select 1 from public.interests i where i.id = runs.interest_id));

create policy chat_turns_own_read on public.chat_turns
  for select to authenticated using (user_id = (select auth.uid()));

create policy notifications_own_read on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants: exactly what the policies above need, by column where it matters.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.plans to authenticated;

grant select on public.profiles to authenticated;
grant update (timezone) on public.profiles to authenticated;

grant select on public.interests to anon, authenticated;
-- visibility and share_slug change only through the sharing RPCs (task 9).
-- No delete: an interest is soft-deleted through deleted_at.
grant insert (topic, doc, cadence, run_at, run_weekday) on public.interests to authenticated;
grant update (topic, doc, cadence, run_at, run_weekday, deleted_at)
  on public.interests to authenticated;

grant select, delete on public.follows to authenticated;

grant select on public.runs to anon, authenticated;

grant select on public.chat_turns to authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant execute on function public.allowance(uuid) to authenticated, service_role;
-- Used by the profiles.timezone check constraint.
grant execute on function public.is_time_zone(text) to authenticated, service_role;
