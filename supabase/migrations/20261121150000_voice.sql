-- Voice in the setup chat (plan/research/abuse.md, "Voice"): the Worker's
-- POST /voice turns a clip of up to a minute into text with Workers AI
-- (@cf/openai/whisper-large-v3-turbo) and the reader edits and sends it.
--
-- Cost, from https://developers.cloudflare.com/workers-ai/platform/pricing/
-- (read 2026-11-20): whisper-large-v3-turbo is $0.0005 per audio minute,
-- 46.63 neurons per audio minute. The Workers Free plan includes 10,000 neurons
-- a day, reset at 00:00 UTC; past that a request fails with an error and is
-- never billed (only Workers Paid charges $0.011 per 1,000 neurons over it).
-- Scout stops at settings.voice_neurons_per_day (9,000) to keep a margin.
--
-- * Each reader gets settings.voice_clips_per_day (5) clips over the rolling 24
--   hours, like every other per-user count.
-- * The global budget follows Cloudflare's day: neurons since 00:00 UTC.
-- * A clip is reserved at a full minute (47 neurons) under a lock before the
--   model call, so parallel requests cannot pass either limit;
--   finish_voice_clip records what the clip really cost. A clip whose call
--   failed keeps its reservation.
-- * The kill switch (settings.paused) stops voice too.

alter table public.settings
  add column voice_clips_per_day integer not null default 5 check (voice_clips_per_day >= 0),
  add column voice_neurons_per_day integer not null default 9000 check (voice_neurons_per_day >= 0);

create table public.voice_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  neurons integer not null default 47 check (neurons >= 0),
  created_at timestamptz not null default now()
);

create index voice_clips_user_created_at on public.voice_clips (user_id, created_at);
create index voice_clips_created_at on public.voice_clips (created_at);

-- No policies, no grants: service role only.
alter table public.voice_clips enable row level security;

-- Reserve one clip for p_user: {"blocked": "paused" | "user" | "global"} or
-- {"id": ...}. The reservation counts at once.
create function public.begin_voice_clip(p_user uuid, p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_settings public.settings;
  v_id uuid;
begin
  select * into v_settings from public.settings;
  if v_settings.paused then
    return jsonb_build_object('blocked', 'paused');
  end if;

  perform pg_advisory_xact_lock(hashtext('voice:' || p_user::text));
  if (select count(*) from public.voice_clips
      where user_id = p_user and created_at >= p_now - interval '24 hours')
     >= v_settings.voice_clips_per_day then
    return jsonb_build_object('blocked', 'user');
  end if;

  perform pg_advisory_xact_lock(hashtext('voice:global'));
  if coalesce((select sum(neurons) from public.voice_clips
               where created_at >= date_trunc('day', p_now at time zone 'utc') at time zone 'utc'), 0)
     + 47 > v_settings.voice_neurons_per_day then
    return jsonb_build_object('blocked', 'global');
  end if;

  insert into public.voice_clips (user_id, neurons, created_at)
  values (p_user, 47, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- What a reserved clip really cost, in neurons.
create function public.finish_voice_clip(p_id uuid, p_neurons integer) returns void
language sql security definer
set search_path = ''
as $$
  update public.voice_clips set neurons = greatest(p_neurons, 0) where id = p_id
$$;

revoke execute on function public.begin_voice_clip(uuid, timestamptz),
  public.finish_voice_clip(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.begin_voice_clip(uuid, timestamptz),
  public.finish_voice_clip(uuid, integer)
  to service_role;
