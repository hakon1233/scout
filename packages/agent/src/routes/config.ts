// /v0/config — same-origin bootstrap (PER-274 split; behavior unchanged).
//
// Hands the served UI its pairing token so the user never has to copy/paste
// it. When the page is served from this companion (http://127.0.0.1:47821/),
// the fetch is same-origin and this returns the token. A cross-origin
// (public) caller is refused — the route is registered with auth
// "same_origin", enforced by the router via isSameOriginCaller — and is in
// any case blocked by the browser's LNA gate before it ever reaches us. The
// token only guards the browser-origin boundary; any local process can
// already read ~/.config/scout/state.json, so this adds no on-machine
// exposure.

import { loadState, interestTopics } from "../state.js";
import { PKG_VERSION } from "../build-info.js";
import { json } from "../http-util.js";
import type { RequestContext, ServerContext } from "./types.js";

export async function handleGetConfig(
  { res, cors }: RequestContext,
  sc: ServerContext,
): Promise<void> {
  const state = await loadState(sc.stateFile);
  json(
    res,
    200,
    {
      token: state.pairing_token ?? null,
      version: PKG_VERSION,
      // The companion is the source of truth for the user's interests
      // (persisted on every POST /v0/interests so the scheduler can run
      // headless). Hand them to the served UI too, so a browser whose
      // localStorage was cleared / is a different profile / a different
      // origin than the one that did first-run setup can still render the
      // brief + a working "Run now" instead of dead-ending on the setup
      // form (PER-157). Same-origin gated like the token above. Mapped to
      // topic strings for back-compat — the rich {id, topic} model lives
      // behind GET /v0/interests (PER-169); this endpoint's `interests`
      // contract stays a plain string[].
      interests: interestTopics(state.interests),
    },
    cors,
  );
}
