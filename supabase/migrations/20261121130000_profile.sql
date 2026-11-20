-- The reader's profile (plan/research/browse.md; fable-review.md 18).
--
-- Optional and private: location, student, role and liked tags. Only the owner
-- reads or writes them (the profiles_own_* policies); they never appear on a
-- topic card. Later the topic picker may read them, server side.
--
-- Display names: the reserved-name check now ignores case, spaces, dots,
-- dashes and look-alike digits, so "Scout-Team", "admin." and "SC0UT" are
-- refused like "Scout team". The team badge still comes from is_team.

-- At most 20 tags, each in the tag pattern.
create function public.liked_tags_ok(p_tags text[]) returns boolean
language sql immutable
set search_path = ''
as $$
  select cardinality(p_tags) <= 20
    and coalesce((select bool_and(t ~ '^[a-z0-9æøå-]{2,24}$') from unnest(p_tags) t), true)
$$;

alter table public.profiles
  add column location text check (char_length(btrim(location)) between 1 and 80),
  add column student boolean,
  add column role text check (char_length(btrim(role)) between 1 and 80),
  add column liked_tags text[] not null default '{}' check (public.liked_tags_ok(liked_tags));

grant update (location, student, role, liked_tags) on public.profiles to authenticated;

-- True for a name that reads as Scout, the Scout team, or an admin.
create function public.is_reserved_name(p_name text) returns boolean
language sql immutable
set search_path = ''
as $$
  select regexp_replace(translate(lower(coalesce(p_name, '')), '0135$@', 'oleisa'),
                        '[^a-zæøå]', '', 'g')
         ~ '^(the)?(scout|admin|administrator|moderator|mod)(team|official|staff|admin|support|hq|app)?$'
      or regexp_replace(translate(lower(coalesce(p_name, '')), '0135$@', 'oleisa'),
                        '[^a-zæøå]', '', 'g')
         ~ '^(team|official)scout$'
$$;

alter table public.profiles drop constraint profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check check (
  display_name is null or (
    char_length(btrim(display_name)) between 1 and 40
    and not public.is_reserved_name(display_name)));

revoke execute on function public.is_reserved_name(text), public.liked_tags_ok(text[])
  from public, anon;
grant execute on function public.is_reserved_name(text), public.liked_tags_ok(text[])
  to authenticated, service_role;
