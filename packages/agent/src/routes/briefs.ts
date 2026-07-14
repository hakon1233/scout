// /v0/briefs + /v0/weekly-brief — brief reads and the weekly digest
// (PER-274 split; behavior unchanged).

import { json } from "../http-util.js";
import { createAndPersistWeeklyBrief } from "../weekly.js";
import type { AuthedRequestContext, ServerContext } from "./types.js";

export async function handleGetBriefs({
  res,
  url,
  cors,
  state,
}: AuthedRequestContext): Promise<void> {
  // Paginated history view (PER-219): when `limit` or `offset` is present,
  // page over the rolling ready-brief history (newest-first) instead of
  // the single last_brief. The feed uses this to render previous editions
  // 3 at a time. Response carries `total` so the client knows when to hide
  // its "Load older briefs" button. Absent both params → the legacy poller
  // contract below is preserved verbatim (returns the single last_brief
  // slot, including pending/failed, filtered by `since`).
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  if (limitRaw !== null || offsetRaw !== null) {
    const clamp = (raw: string | null, def: number, max: number) => {
      if (raw === null) return def;
      if (raw.trim() === "") return def;
      const n = Number(raw);
      if (!Number.isFinite(n)) return def;
      return Math.min(max, Math.max(0, Math.floor(n)));
    };
    const limit = Math.max(1, clamp(limitRaw, 3, 50));
    const offset = clamp(offsetRaw, 0, Number.MAX_SAFE_INTEGER);
    const history = state.briefs ?? [];
    const page = history.slice(offset, offset + limit);
    json(res, 200, { briefs: page, total: history.length }, cors);
    return;
  }
  const since = url.searchParams.get("since");
  const last = state.last_brief;
  const matches = last && (!since || last.generated_at > since) ? [last] : [];
  json(res, 200, { briefs: matches }, cors);
}

export async function handlePostWeeklyBrief(
  { res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const brief = await createAndPersistWeeklyBrief(sc.stateFile);
  json(res, 201, { brief }, cors);
}
