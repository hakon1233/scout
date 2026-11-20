-- Publishing and tags (plan/research/browse.md, abuse.md; fable-review.md 13, 18).
--
-- Going public is the Worker's POST /publish. It calls publish_start, which
-- checks the owner, the public cap, the publish rate and the 24 h wait, and
-- records the check; then one Haiku call reads the topic; then publish_finish
-- records the verdict and, on approve, sets the tags and makes the topic public.
-- Both are service role only.
--
-- * Publish rate: plans.publishes_per_day (5) checks per rolling 24 h, approved
--   or refused, so a refused doc cannot be retried without end.
-- * A topic that left public waits 24 h (interests.left_public_at) before it
--   can go public again.
-- * Tags: lower case, ^[a-z0-9æøå-]{2,24}$, at most 5. Owners edit them with
--   set_topic_tags; that never re-runs the check and never unpublishes. Editing
--   the topic or doc still drops a public topic to shared.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.plans
  add column publishes_per_day integer not null default 5 check (publishes_per_day >= 0);

alter table public.interests
  add column published_at timestamptz,
  add column left_public_at timestamptz;

-- True when every tag is normalised and there are at most 5, none twice.
create function public.tags_ok(p_tags text[]) returns boolean
language sql immutable
set search_path = ''
as $$
  select cardinality(p_tags) <= 5
    and coalesce((select bool_and(t ~ '^[a-z0-9æøå-]{2,24}$') from unnest(p_tags) t), true)
    and (select count(distinct t) from unnest(p_tags) t) = cardinality(p_tags)
$$;

-- NOT VALID: old rows are left alone; every insert and update is checked.
alter table public.interests
  add constraint interests_tags_ok check (public.tags_ok(tags)) not valid;

-- Trims and lower-cases, drops empties and repeats (first wins). Raises 22023
-- when a tag breaks the pattern or more than 5 remain.
create function public.normalize_tags(p_tags text[]) returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v_tag text;
begin
  foreach v_tag in array coalesce(p_tags, '{}') loop
    v_tag := lower(btrim(v_tag));
    continue when v_tag = '' or v_tag = any(v_out);
    if v_tag !~ '^[a-z0-9æøå-]{2,24}$' then
      raise exception 'tags: "%" is not a tag (2-24 letters, digits or -)', v_tag
        using errcode = '22023', hint = 'bad_tag';
    end if;
    v_out := v_out || v_tag;
  end loop;
  if cardinality(v_out) > 5 then
    raise exception 'tags: at most 5' using errcode = '22023', hint = 'too_many_tags';
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Edits: topic or doc unpublish, tags do not; leaving public is stamped
-- ---------------------------------------------------------------------------

create or replace function public.unpublish_on_edit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.visibility = 'public' and (
       new.topic is distinct from old.topic or new.doc is distinct from old.doc
       or new.deleted_at is not null) then
    new.visibility := 'shared';
  end if;
  if old.visibility = 'public' and new.visibility <> 'public' then
    new.left_public_at := now();
  end if;
  return new;
end;
$$;

drop trigger interests_unpublish_on_edit on public.interests;
create trigger interests_unpublish_on_edit
  before update of topic, doc, deleted_at, visibility on public.interests
  for each row execute function public.unpublish_on_edit();

-- ---------------------------------------------------------------------------
-- Publish checks: one row per Haiku check, the audit trail and the rate count
-- ---------------------------------------------------------------------------

create table public.publish_checks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete cascade,
  -- md5 of topic and doc when the check started; finish refuses if they moved.
  text_hash text not null,
  outcome text check (outcome in ('approved', 'refused')),
  reason text check (char_length(reason) <= 300),
  tags text[] check (tags is null or public.tags_ok(tags)),
  -- What the Haiku call cost.
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index publish_checks_user_idx on public.publish_checks (user_id, created_at);
create index publish_checks_interest_idx on public.publish_checks (interest_id);

alter table public.publish_checks enable row level security;

-- Admins read the trail; nobody else reads or writes it directly.
create policy publish_checks_admin_read on public.publish_checks
  for select to authenticated
  using (coalesce((select is_admin from public.profiles where id = auth.uid()), false));

revoke all on public.publish_checks from public, anon, authenticated;
grant select on public.publish_checks to authenticated;

create function public.text_hash(p_topic text, p_doc text) returns text
language sql immutable
set search_path = ''
as $$ select md5(coalesce(p_topic, '') || chr(31) || coalesce(p_doc, '')) $$;

-- Service role. Checks and records a publish attempt; returns what the check
-- reads: {checkId, title, doc, displayName, team, maxDocChars}.
--   P0002 no such live, unhidden interest of p_user
--   22023 already public (hint already_public)
--   P0001 hint max_public_interests | publishes_per_day | republish_wait
create function public.publish_start(p_user uuid, p_interest uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_i public.interests;
  v_plan public.plans;
  v_team boolean;
  v_name text;
  v_public integer;
  v_checks integer;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('publish:' || p_user::text));

  select * into v_i from public.interests
  where id = p_interest and owner_id = p_user and deleted_at is null and hidden_at is null;
  if not found then
    raise exception 'publish: no such interest' using errcode = 'P0002';
  end if;
  if v_i.visibility = 'public' then
    raise exception 'publish: already public' using errcode = '22023', hint = 'already_public';
  end if;

  select coalesce(pr.is_team, false), pr.display_name into v_team, v_name
  from public.profiles pr where pr.id = p_user;
  if not found then
    raise exception 'publish: no profile' using errcode = 'P0002';
  end if;
  select pl.* into v_plan
  from public.plans pl
  where pl.id = coalesce((select plan from public.profiles where id = p_user), 'free');

  if not v_team then
    select count(*) into v_public from public.interests
    where owner_id = p_user and visibility = 'public' and deleted_at is null;
    if v_public >= v_plan.max_public_interests then
      raise exception 'quota: % of % public interests used', v_public, v_plan.max_public_interests
        using errcode = 'P0001', hint = 'max_public_interests';
    end if;

    select count(*) into v_checks from public.publish_checks
    where user_id = p_user and created_at > now() - interval '24 hours';
    if v_checks >= v_plan.publishes_per_day then
      raise exception 'quota: % of % publishes used today', v_checks, v_plan.publishes_per_day
        using errcode = 'P0001', hint = 'publishes_per_day';
    end if;

    if v_i.left_public_at > now() - interval '24 hours' then
      raise exception 'quota: this topic left public less than 24 hours ago'
        using errcode = 'P0001', hint = 'republish_wait';
    end if;
  end if;

  insert into public.publish_checks (user_id, interest_id, text_hash)
  values (p_user, p_interest, public.text_hash(v_i.topic, v_i.doc))
  returning id into v_id;

  return jsonb_build_object(
    'checkId', v_id,
    'title', v_i.topic,
    'doc', v_i.doc,
    'displayName', v_name,
    'team', v_team,
    'maxDocChars', v_plan.max_doc_chars);
end;
$$;

-- Service role. Records the check's verdict. On approve sets the tags and makes
-- the topic public; returns its share slug (null on refuse).
--   P0002 no open check of p_user's
--   40001 the topic or doc changed since the check started (hint changed)
create function public.publish_finish(
  p_user uuid, p_check bigint, p_approved boolean, p_tags text[], p_reason text,
  p_cost_usd numeric default 0)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c public.publish_checks;
  v_tags text[];
  v_slug text;
begin
  perform pg_advisory_xact_lock(hashtext('publish:' || p_user::text));

  select * into v_c from public.publish_checks
  where id = p_check and user_id = p_user and outcome is null
    and created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'publish: no open check' using errcode = 'P0002';
  end if;

  if not p_approved then
    update public.publish_checks
    set outcome = 'refused', reason = left(coalesce(p_reason, ''), 300), finished_at = now(),
        cost_usd = greatest(coalesce(p_cost_usd, 0), 0)
    where id = p_check;
    return null;
  end if;

  v_tags := public.normalize_tags(p_tags);
  if cardinality(v_tags) = 0 then
    raise exception 'publish: an approved topic needs a tag' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.interests
    where id = v_c.interest_id and public.text_hash(topic, doc) = v_c.text_hash) then
    raise exception 'publish: the topic changed during its check'
      using errcode = '40001', hint = 'changed';
  end if;

  update public.interests set tags = v_tags where id = v_c.interest_id;
  v_slug := public.set_visibility(p_user, v_c.interest_id, 'public');
  update public.interests set published_at = now() where id = v_c.interest_id;
  update public.publish_checks
  set outcome = 'approved', tags = v_tags, finished_at = now(),
      cost_usd = greatest(coalesce(p_cost_usd, 0), 0)
  where id = p_check;
  return v_slug;
end;
$$;

-- An owner sets their topic's tags. Never re-checks, never unpublishes.
create function public.set_topic_tags(p_interest uuid, p_tags text[]) returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tags text[];
begin
  if auth.uid() is null then
    raise exception 'set_topic_tags: sign in first' using errcode = '42501';
  end if;
  v_tags := public.normalize_tags(p_tags);
  update public.interests set tags = v_tags
  where id = p_interest and owner_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'set_topic_tags: no such interest' using errcode = 'P0002';
  end if;
  return v_tags;
end;
$$;

revoke execute on function public.tags_ok(text[]), public.normalize_tags(text[]),
  public.text_hash(text, text), public.publish_start(uuid, uuid),
  public.publish_finish(uuid, bigint, boolean, text[], text, numeric),
  public.set_topic_tags(uuid, text[])
  from public, anon, authenticated;

-- tags_ok runs in the interests check, so writers need it.
grant execute on function public.tags_ok(text[]) to authenticated, service_role;
grant execute on function public.normalize_tags(text[]), public.text_hash(text, text)
  to service_role;
grant execute on function public.publish_start(uuid, uuid),
  public.publish_finish(uuid, bigint, boolean, text[], text, numeric)
  to service_role;
grant execute on function public.set_topic_tags(uuid, text[]) to authenticated;
