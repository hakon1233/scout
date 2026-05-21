-- Notiva v4 schema (Path 1 — local companion).
-- Tables: interests, briefs, articles, companion_pairings, companion_devices, usage_exa_daily.
-- All user-owned tables have RLS enabled with "user_id = auth.uid()" policies so a user
-- only sees their own rows. The companion authenticates as the user via a JWT minted by
-- the `companion-token` edge function, so the same RLS policies apply to it.

create extension if not exists "pgcrypto";

-- interests --------------------------------------------------------------------
create table if not exists public.interests (
  user_id    uuid not null references auth.users(id) on delete cascade,
  topic      text not null check (length(trim(topic)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.interests enable row level security;

create policy "interests_select_own" on public.interests
  for select using (user_id = auth.uid());
create policy "interests_insert_own" on public.interests
  for insert with check (user_id = auth.uid());
create policy "interests_update_own" on public.interests
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "interests_delete_own" on public.interests
  for delete using (user_id = auth.uid());

-- briefs ----------------------------------------------------------------------
create type public.brief_status as enum ('pending', 'ready', 'failed');

create table if not exists public.briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  generated_at timestamptz not null default now(),
  summary_md   text,
  status       public.brief_status not null default 'pending',
  error_msg    text
);

create index if not exists briefs_user_generated_idx
  on public.briefs (user_id, generated_at desc);

alter table public.briefs enable row level security;

create policy "briefs_select_own" on public.briefs
  for select using (user_id = auth.uid());
create policy "briefs_insert_own" on public.briefs
  for insert with check (user_id = auth.uid());
create policy "briefs_update_own" on public.briefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "briefs_delete_own" on public.briefs
  for delete using (user_id = auth.uid());

-- articles --------------------------------------------------------------------
create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid not null references public.briefs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  url           text not null,
  title         text,
  snippet       text,
  source_score  real,
  fetched_at    timestamptz not null default now()
);

create index if not exists articles_brief_idx on public.articles (brief_id);
create index if not exists articles_user_idx on public.articles (user_id, fetched_at desc);

alter table public.articles enable row level security;

create policy "articles_select_own" on public.articles
  for select using (user_id = auth.uid());
create policy "articles_insert_own" on public.articles
  for insert with check (user_id = auth.uid());
create policy "articles_delete_own" on public.articles
  for delete using (user_id = auth.uid());

-- companion_pairings ----------------------------------------------------------
-- Short-lived one-time codes shown in the web UI. The companion exchanges the
-- code via the `companion-token` edge function for a Supabase JWT scoped to
-- the user. We never store any Anthropic token here.
create table if not exists public.companion_pairings (
  code        text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists pairings_user_idx on public.companion_pairings (user_id);

alter table public.companion_pairings enable row level security;

-- A user can create + see + revoke their own pairing codes; the edge function
-- (running as service-role) is what marks `used_at` on redemption.
create policy "pairings_select_own" on public.companion_pairings
  for select using (user_id = auth.uid());
create policy "pairings_insert_own" on public.companion_pairings
  for insert with check (user_id = auth.uid());
create policy "pairings_delete_own" on public.companion_pairings
  for delete using (user_id = auth.uid());

-- companion_devices -----------------------------------------------------------
create table if not exists public.companion_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists devices_user_idx on public.companion_devices (user_id);

alter table public.companion_devices enable row level security;

create policy "devices_select_own" on public.companion_devices
  for select using (user_id = auth.uid());
create policy "devices_update_own" on public.companion_devices
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "devices_delete_own" on public.companion_devices
  for delete using (user_id = auth.uid());

-- usage_exa_daily -------------------------------------------------------------
-- Counter the `exa-search` edge function bumps to enforce per-user/day caps.
create table if not exists public.usage_exa_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_exa_daily enable row level security;

create policy "usage_select_own" on public.usage_exa_daily
  for select using (user_id = auth.uid());
-- writes happen only from edge functions running as service-role, which bypasses RLS.
