-- Stubs for running supabase/tests in PGlite (pnpm test:sql): the hosted schema's
-- roles and auth schema, and a small pgTAP stand-in that records each check in
-- extensions.tap. Not a migration; never applied to a real database.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key, email text, aud text, role text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;

-- pgTAP shim
create table extensions.tap (n serial, ok boolean, descr text, diag text);
grant all on extensions.tap to public;
grant all on sequence extensions.tap_n_seq to public;
create function extensions.no_plan() returns setof boolean language sql as $$ select true where false $$;
create function extensions.tap_rec(p_ok boolean, p_descr text, p_diag text default null) returns text
language plpgsql security definer as $$
begin insert into extensions.tap (ok, descr, diag) values (coalesce(p_ok,false), p_descr, p_diag);
return case when p_ok then 'ok ' else 'not ok ' end || coalesce(p_descr,''); end $$;
create function extensions.ok(boolean, text default null) returns text language sql as $$ select extensions.tap_rec($1, $2, 'got ' || coalesce($1::text,'NULL')) $$;
create function extensions.is(anyelement, anyelement, text default null) returns text language sql as $$
  select extensions.tap_rec($1 is not distinct from $2, $3, 'have ' || coalesce($1::text,'NULL') || ' want ' || coalesce($2::text,'NULL')) $$;
create function extensions.is(text, text, text default null) returns text language sql as $$
  select extensions.tap_rec($1 is not distinct from $2, $3, 'have ' || coalesce($1,'NULL') || ' want ' || coalesce($2,'NULL')) $$;
create function extensions.isnt(anyelement, anyelement, text default null) returns text language sql as $$
  select extensions.tap_rec($1 is distinct from $2, $3, 'both ' || coalesce($1::text,'NULL')) $$;
create function extensions.matches(text, text, text default null) returns text language sql as $$
  select extensions.tap_rec($1 ~ $2, $3, 'have ' || coalesce($1,'NULL')) $$;
create function extensions.results_eq(text, anyarray, text default null) returns text language plpgsql as $$
declare v_have text[]; v_want text[];
begin
  execute 'select array_agg(x::text) from (' || $1 || ') q(x)' into v_have;
  select array_agg(e::text) into v_want from unnest($2) e;
  return extensions.tap_rec(coalesce(v_have,'{}') = coalesce(v_want,'{}'), $3, 'have ' || coalesce(v_have::text,'{}') || ' want ' || coalesce(v_want::text,'{}'));
end $$;
create function extensions.results_eq(text, text, text default null) returns text language plpgsql as $$
declare v_have text[]; v_want text[];
begin
  execute 'select array_agg(row(q.*)::text) from (' || $1 || ') q' into v_have;
  execute 'select array_agg(row(q.*)::text) from (' || $2 || ') q' into v_want;
  return extensions.tap_rec(coalesce(v_have,'{}') = coalesce(v_want,'{}'), $3, 'have ' || coalesce(v_have::text,'{}') || ' want ' || coalesce(v_want::text,'{}'));
end $$;
create function extensions.throws_ok(text, text, text default null, text default null) returns text language plpgsql as $$
declare v_state text;
begin
  begin execute $1; exception when others then v_state := sqlstate; end;
  return extensions.tap_rec(v_state is not distinct from $2, $4, 'sqlstate ' || coalesce(v_state,'none'));
end $$;
create function extensions.lives_ok(text, text default null) returns text language plpgsql as $$
declare v_err text;
begin
  begin execute $1; exception when others then v_err := sqlstate || ' ' || sqlerrm; end;
  return extensions.tap_rec(v_err is null, $2, v_err);
end $$;
grant execute on all functions in schema extensions to public;
