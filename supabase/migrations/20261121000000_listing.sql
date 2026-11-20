-- Listing, hiding and public reads (plan/research/fable-review.md items 1, 4, 5,
-- 13, 18, 23, 26, 30).
--
-- An interest is listed (others may find, follow and read it) when it is shared
-- or public, live, and not hidden by an admin. interest_is_listed() is the one
-- place that says so; every reader path below uses it.
--
-- Public reads go through public_topics() and interest_by_slug(), which return a
-- topic card: title, tags, owner display name, team flag and the latest ready
-- briefs. The intent doc, owner id and run costs are never public. Signed-out
-- visitors have no table access at all.
--
-- Going public is the Worker's job (its publish check runs first): the
-- three-argument set_visibility is service role only. Readers share or unshare
-- with set_sharing. Editing a public interest's topic, doc or tags, or deleting
-- it, drops it back to shared, so a new text needs a new check.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.interests
  add column hidden_at timestamptz,
  add column hidden_reason text check (char_length(hidden_reason) <= 500),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10),
  -- Switched off by its owner (or the team, for seeded topics): no scheduled runs.
  add column paused boolean not null default false;

grant update (paused) on public.interests to authenticated;

-- Shown as the owner of a public interest. Reserved names cannot be taken; the
-- team badge comes from is_team, never from the name.
alter table public.profiles
  add column display_name text check (
    display_name is null or (
      char_length(btrim(display_name)) between 1 and 40
      and lower(btrim(display_name)) not in ('scout', 'scout team', 'admin'))),
  add column is_team boolean not null default false;

grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The one predicate
-- ---------------------------------------------------------------------------

-- Also a PostgREST computed column: `interests?interest_is_listed=is.true`.
create function public.interest_is_listed(i public.interests) returns boolean
language sql stable
set search_path = ''
as $$
  select i.visibility in ('shared', 'public') and i.deleted_at is null and i.hidden_at is null
$$;

grant execute on function public.interest_is_listed(public.interests)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table access: owners and followers only, by named run columns
-- ---------------------------------------------------------------------------

drop policy interests_public_read on public.interests;
drop policy interests_follower_read on public.interests;
create policy interests_follower_read on public.interests
  for select to authenticated
  using (
    public.interest_is_listed(interests)
    and exists (
      select 1 from public.follows f
      where f.interest_id = interests.id and f.user_id = (select auth.uid())));

drop policy runs_read on public.runs;
create policy runs_read on public.runs
  for select to authenticated
  using (exists (select 1 from public.interests i where i.id = runs.interest_id));

revoke select on public.interests from anon;
revoke select on public.runs from anon, authenticated;
-- Not cost_usd, requested_by or attempts.
grant select (id, interest_id, status, scheduled_for, section_md, coverage, searches,
              error_msg, created_at, started_at, finished_at)
  on public.runs to authenticated;

-- ---------------------------------------------------------------------------
-- Topic cards: what anyone may see of a listed interest
-- ---------------------------------------------------------------------------

create function public.topic_card(i public.interests) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'slug', i.share_slug,
    'title', i.topic,
    'tags', to_jsonb(i.tags),
    'owner_name', case when pr.is_team then 'Scout team' else pr.display_name end,
    'team', coalesce(pr.is_team, false),
    'briefs', coalesce((
      select jsonb_agg(b order by b.finished_at desc)
      from (
        select r.id, r.section_md, r.coverage, r.finished_at
        from public.runs r
        where r.interest_id = i.id and r.status = 'ready'
        order by r.finished_at desc nulls last
        limit 3) b), '[]'::jsonb))
  from (select 1) one
  left join public.profiles pr on pr.id = i.owner_id
$$;

-- The public catalog, newest first, optionally one tag. At most 50 cards.
create function public.public_topics(p_tag text default null, p_limit integer default 50)
returns setof jsonb
language sql stable security definer
set search_path = ''
as $$
  select public.topic_card(i)
  from public.interests i
  where i.visibility = 'public' and public.interest_is_listed(i)
    and (p_tag is null or p_tag = any(i.tags))
  order by i.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 0), 50)
$$;

-- What a link shows, signed in or out: the topic card plus the reader's own
-- relation to it and the latest brief as `run`. Null unless listed.
drop function public.interest_by_slug(text);
create function public.interest_by_slug(p_slug text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select public.topic_card(i) || jsonb_build_object(
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
  where i.share_slug = p_slug and public.interest_is_listed(i)
$$;

-- Follow from a link. Returns the interest id. Following your own is a no-op.
create or replace function public.follow(p_slug text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.interests;
begin
  if auth.uid() is null then
    raise exception 'follow: sign in first' using errcode = '42501';
  end if;
  select * into v_row from public.interests i
  where i.share_slug = p_slug and public.interest_is_listed(i);
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

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

drop function public.set_visibility(uuid, text);

-- Service role only (the Worker's publish route, after its check). Sets any
-- visibility on p_user's live, unhidden interest. Returns the share slug (null
-- when private).
create function public.set_visibility(p_user uuid, p_interest uuid, p_visibility text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if p_visibility not in ('private', 'shared', 'public') then
    raise exception 'set_visibility: unknown visibility %', p_visibility
      using errcode = '22023';
  end if;
  update public.interests
  set visibility = p_visibility,
      share_slug = case when p_visibility = 'private' then null
                        else coalesce(share_slug, public.new_share_slug()) end
  where id = p_interest and owner_id = p_user and deleted_at is null
    and (hidden_at is null or p_visibility = 'private')
  returning share_slug into v_slug;
  if not found then
    raise exception 'set_visibility: no such interest' using errcode = 'P0002';
  end if;
  return v_slug;
end;
$$;

-- A reader shares by link or makes private. Never public.
create function public.set_sharing(p_interest uuid, p_visibility text) returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'set_sharing: sign in first' using errcode = '42501';
  end if;
  if p_visibility not in ('private', 'shared') then
    raise exception 'set_sharing: only private or shared; publishing goes through its check'
      using errcode = '22023';
  end if;
  return public.set_visibility(auth.uid(), p_interest, p_visibility);
end;
$$;

-- A changed text, or a delete, takes a public interest back to shared.
create function public.unpublish_on_edit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.visibility = 'public' and (
       new.topic is distinct from old.topic or new.doc is distinct from old.doc
       or new.tags is distinct from old.tags or new.deleted_at is not null) then
    new.visibility := 'shared';
  end if;
  return new;
end;
$$;

create trigger interests_unpublish_on_edit
  before update of topic, doc, tags, deleted_at on public.interests
  for each row execute function public.unpublish_on_edit();

-- ---------------------------------------------------------------------------
-- Notices to followers and owners
-- ---------------------------------------------------------------------------

-- unshared / deleted / stopped carry a snapshot (topic, intent doc, cadence) a
-- follower may copy with host_copy; hidden carries no doc and gives no copy.
-- The owner's hidden notice carries the reason.
update public.notifications set kind = 'unshared' where kind = 'stopped_sharing';
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('run_failed', 'over_quota', 'hidden', 'stopped', 'unshared', 'deleted'));

drop trigger interests_stopped_sharing on public.interests;
drop function public.notify_stopped_sharing();

create function public.notify_followers() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if public.interest_is_listed(old) and not public.interest_is_listed(new) then
    -- No longer listed: every follower is told and the follows end.
    v_kind := case when new.hidden_at is not null then 'hidden'
                   when new.deleted_at is not null then 'deleted'
                   else 'unshared' end;
    insert into public.notifications (user_id, kind, payload)
    select f.user_id, v_kind,
           jsonb_build_object('interest_id', old.id, 'topic', old.topic)
           || case when v_kind = 'hidden' then '{}'::jsonb
                   else jsonb_build_object('doc', old.doc, 'cadence', old.cadence) end
    from public.follows f where f.interest_id = old.id;
    delete from public.follows where interest_id = old.id;
  elsif public.interest_is_listed(new)
        and old.cadence <> 'off' and not old.paused
        and (new.cadence = 'off' or new.paused) then
    -- Still listed but no longer running: followers are told; they keep following.
    insert into public.notifications (user_id, kind, payload)
    select f.user_id, 'stopped',
           jsonb_build_object('interest_id', old.id, 'topic', old.topic,
                              'doc', old.doc, 'cadence', old.cadence)
    from public.follows f where f.interest_id = old.id;
  end if;

  if old.hidden_at is null and new.hidden_at is not null then
    insert into public.notifications (user_id, kind, payload)
    values (new.owner_id, 'hidden',
            jsonb_build_object('interest_id', new.id, 'topic', new.topic,
                               'reason', new.hidden_reason));
  end if;
  return new;
end;
$$;

create trigger interests_notify_followers
  after update of visibility, deleted_at, hidden_at, cadence, paused on public.interests
  for each row execute function public.notify_followers();

-- "Host it yourself": copy a notice's snapshot into the caller's own private
-- interest, switched off so it never puts them over a cadence limit. The
-- interest trigger still enforces the list cap. Marks the notice read.
create or replace function public.host_copy(p_notification uuid) returns uuid
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
    and kind in ('unshared', 'deleted', 'stopped') and read_at is null
  for update;
  if not found then
    raise exception 'host_copy: no such notice' using errcode = 'P0002';
  end if;

  insert into public.interests (owner_id, topic, doc, cadence)
  values (auth.uid(), v_payload ->> 'topic', coalesce(v_payload ->> 'doc', ''), 'off')
  returning id into v_id;

  update public.notifications set read_at = now() where id = p_notification;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin hide
-- ---------------------------------------------------------------------------

-- An admin (signed in) or the service role hides an interest from everyone but
-- its owner, with a short reason the owner is shown. There is no unhide call.
create function public.hide_interest(p_interest uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not coalesce(
      (select is_admin from public.profiles where id = auth.uid()), false) then
    raise exception 'hide_interest: admins only' using errcode = '42501';
  end if;
  update public.interests
  set hidden_at = coalesce(hidden_at, now()),
      hidden_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Hidden by Scout.'), 500)
  where id = p_interest;
  if not found then
    raise exception 'hide_interest: no such interest' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.topic_card(public.interests),
  public.public_topics(text, integer), public.interest_by_slug(text),
  public.set_visibility(uuid, uuid, text), public.set_sharing(uuid, text),
  public.unpublish_on_edit(), public.notify_followers(), public.host_copy(uuid),
  public.hide_interest(uuid, text)
  from public, anon, authenticated;

grant execute on function public.public_topics(text, integer), public.interest_by_slug(text)
  to anon, authenticated, service_role;
grant execute on function public.set_visibility(uuid, uuid, text) to service_role;
grant execute on function public.set_sharing(uuid, text), public.host_copy(uuid)
  to authenticated;
grant execute on function public.hide_interest(uuid, text) to authenticated, service_role;
