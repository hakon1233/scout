-- Picks version 3. Version 2's Worker gave Haiku 1024 output tokens; its
-- default thinking counts against them, so a reply could be cut off and was
-- stored as "no picks" at the current version, never made again. The Worker
-- now leaves room for thinking and treats a cut-off reply as a failed call.
-- Bumping the version makes every cached ranking stale, so the minute tick
-- makes them again (at most hourly per reader).
--
-- Must equal core's PICKS_VERSION (packages/core/src/picks-prompt.ts).

create or replace function public.picks_version() returns integer
language sql immutable
set search_path = ''
as $$ select 3 $$;

revoke execute on function public.picks_version() from public, anon, authenticated;
