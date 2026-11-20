-- Sharing: an interest is private, shared (anyone with the link may follow) or
-- public (in the catalog; only an admin may make one). Followers read the host's
-- runs (RLS in the schema migration) and pay nothing: a shared interest counts on
-- the host's quota, a public one on no one's.
--
-- When a host makes a shared or public interest private, or deletes it, every
-- follower gets a stopped_sharing notice with a snapshot (topic, intent doc) and
-- the follow ends. host_copy turns that notice into the follower's own private
-- interest, within their own limits (the interest trigger checks them).
--
-- All writes go through these functions; visibility and share_slug have no
-- column grants.

create function public.new_share_slug() returns text
language sql volatile
set search_path = ''
as $$ select replace(gen_random_uuid()::text, '-', '') $$;

-- The owner sets visibility. Returns the share slug (null when private).
create function public.set_visibility(p_interest uuid, p_visibility text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.interests;
begin
  if auth.uid() is null then
    raise exception 'set_visibility: sign in first' using errcode = '42501';
  end if;
  if p_visibility not in ('private', 'shared', 'public') then
    raise exception 'set_visibility: unknown visibility %', p_visibility
      using errcode = '22023';
  end if;
  select * into v_row from public.interests
  where id = p_interest and owner_id = auth.uid() and deleted_at is null
  for update;
  if not found then
    raise exception 'set_visibility: no such interest' using errcode = 'P0002';
  end if;
  if p_visibility = 'public' and not coalesce(
      (select is_admin from public.profiles where id = auth.uid()), false) then
    raise exception 'set_visibility: only an admin may make an interest public'
      using errcode = '42501';
  end if;

  update public.interests
  set visibility = p_visibility,
      share_slug = case when p_visibility = 'private' then null
                        else coalesce(share_slug, public.new_share_slug()) end
  where id = p_interest
  returning share_slug into v_row.share_slug;
  return v_row.share_slug;
end;
$$;

-- Followers of an interest that stops being shared get a notice; the follows end.
create function public.notify_stopped_sharing() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.visibility in ('shared', 'public') and old.deleted_at is null
     and (new.visibility = 'private' or new.deleted_at is not null) then
    insert into public.notifications (user_id, kind, payload)
    select f.user_id, 'stopped_sharing',
           jsonb_build_object('interest_id', old.id, 'topic', old.topic,
                              'doc', old.doc, 'cadence', old.cadence)
    from public.follows f where f.interest_id = old.id;
    delete from public.follows where interest_id = old.id;
  end if;
  return new;
end;
$$;

create trigger interests_stopped_sharing
  after update of visibility, deleted_at on public.interests
  for each row execute function public.notify_stopped_sharing();

-- Follow from a link. Returns the interest id. Following your own interest is a
-- no-op that still returns its id.
create function public.follow(p_slug text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.interests;
begin
  if auth.uid() is null then
    raise exception 'follow: sign in first' using errcode = '42501';
  end if;
  select * into v_row from public.interests
  where share_slug = p_slug and visibility in ('shared', 'public')
    and deleted_at is null;
  if not found then
    raise exception 'follow: no such shared interest' using errcode = 'P0002';
  end if;
  if v_row.owner_id <> auth.uid() then
    insert into public.follows (user_id, interest_id)
    values (auth.uid(), v_row.id)
    on conflict do nothing;
  end if;
  return v_row.id;
end;
$$;

-- What a link shows, signed in or out: the interest and its latest ready run.
-- Null when the link is unknown, private or deleted.
create function public.interest_by_slug(p_slug text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'topic', i.topic,
    'visibility', i.visibility,
    'owned', i.owner_id = auth.uid(),
    'following', exists (
      select 1 from public.follows f
      where f.interest_id = i.id and f.user_id = auth.uid()),
    'run', (
      select jsonb_build_object('id', r.id, 'section_md', r.section_md,
                                'coverage', r.coverage, 'finished_at', r.finished_at)
      from public.runs r
      where r.interest_id = i.id and r.status = 'ready'
      order by r.finished_at desc nulls last
      limit 1))
  from public.interests i
  where i.share_slug = p_slug and i.visibility in ('shared', 'public')
    and i.deleted_at is null
$$;

-- "Host it yourself": copy a stopped_sharing notice's snapshot into the caller's
-- own private interest, paused. The interest trigger enforces their limits.
-- Marks the notice read. Returns the new interest id.
create function public.host_copy(p_notification uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'host_copy: sign in first' using errcode = '42501';
  end if;
  select payload into v_payload from public.notifications
  where id = p_notification and user_id = auth.uid()
    and kind = 'stopped_sharing' and read_at is null
  for update;
  if not found then
    raise exception 'host_copy: no such notice' using errcode = 'P0002';
  end if;

  insert into public.interests (owner_id, topic, doc)
  values (auth.uid(), v_payload ->> 'topic', coalesce(v_payload ->> 'doc', ''))
  returning id into v_id;

  update public.notifications set read_at = now() where id = p_notification;
  return v_id;
end;
$$;

revoke execute on function public.new_share_slug(),
  public.set_visibility(uuid, text), public.notify_stopped_sharing(),
  public.follow(text), public.interest_by_slug(text), public.host_copy(uuid)
  from public, anon, authenticated;
grant execute on function public.set_visibility(uuid, text), public.follow(text),
  public.host_copy(uuid) to authenticated;
grant execute on function public.interest_by_slug(text) to anon, authenticated;
