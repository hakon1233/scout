-- Push notifications: "Your brief is ready" on a reader's devices.
--
-- One row per device (a browser's push subscription). A reader saves a device
-- with save_push_subscription and sees and deletes only their own. The Worker
-- (service role) asks push_targets for the devices to notify when a run is
-- ready, and deletes a device the push service says is gone (404/410).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_own_read on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_own_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

-- Saves the caller's device. A device another reader saved before (someone
-- else signed in on it) becomes the caller's: one device, one reader.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'save_push_subscription: sign in first' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        created_at = now();
end;
$$;

-- The devices to tell that a run's brief is ready: its interest's owner and
-- followers. None unless the run is ready and its interest is live.
create function public.push_targets(p_run uuid)
returns table (endpoint text, p256dh text, auth text, topic text)
language sql stable security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth, i.topic
  from public.runs r
  join public.interests i on i.id = r.interest_id and i.deleted_at is null
  join public.push_subscriptions s
    on s.user_id = i.owner_id
    or s.user_id in (select f.user_id from public.follows f where f.interest_id = i.id)
  where r.id = p_run and r.status = 'ready'
$$;

revoke execute on function public.save_push_subscription(text, text, text),
  public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.push_targets(uuid) to service_role;
