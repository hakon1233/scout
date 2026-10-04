// The /v0 dispatch table: pathname → method → route spec.
//
// Adding a route = adding a table entry + a handler module; the router
// (server.ts) supplies origin gating, auth, CORS and error handling uniformly,
// so a new route CANNOT diverge on those. V0_ROUTE_METHODS (the 405 Allow
// contract) is derived from this table below — the two can never
// drift apart the way a hand-maintained parallel list could.
//
// Method order inside each entry is meaningful: it is the order the `Allow`
// header lists methods in, preserved verbatim from the pre-split literal.

import { handleVersion } from "./meta.js";
import { handleGetConfig } from "./config.js";
import {
  handleGetInterests,
  handlePostInterests,
  handlePutInterests,
} from "./interests.js";
import { handleGetBriefs, handlePostWeeklyBrief } from "./briefs.js";
import { handleGetSchedule, handlePutSchedule } from "./schedule.js";
import {
  handleGetChat,
  handlePostChat,
  handlePostChatConfirmDelete,
  handlePostChatConfirmRewrite,
  handlePostChatStop,
} from "./chat.js";
import { PATHS } from "../contract.js";
import type { V0RouteSpec } from "./types.js";

export const V0_ROUTES: Record<
  string,
  Record<string, V0RouteSpec> | undefined
> = {
  [PATHS.version]: {
    GET: { auth: "none", handle: handleVersion },
  },
  [PATHS.config]: {
    GET: { auth: "same_origin", handle: handleGetConfig },
  },
  [PATHS.interests]: {
    GET: { auth: "bearer", handle: handleGetInterests },
    POST: { auth: "bearer", handle: handlePostInterests },
    PUT: { auth: "bearer", handle: handlePutInterests },
  },
  [PATHS.briefs]: {
    GET: { auth: "bearer", handle: handleGetBriefs },
  },
  [PATHS.weeklyBrief]: {
    POST: { auth: "bearer", handle: handlePostWeeklyBrief },
  },
  [PATHS.schedule]: {
    GET: { auth: "bearer", handle: handleGetSchedule },
    PUT: { auth: "bearer", handle: handlePutSchedule },
  },
  [PATHS.chat]: {
    GET: { auth: "bearer", handle: handleGetChat },
    POST: { auth: "bearer", handle: handlePostChat },
  },
  [PATHS.chatStop]: {
    POST: { auth: "bearer", handle: handlePostChatStop },
  },
  [PATHS.chatConfirmDelete]: {
    POST: { auth: "bearer", handle: handlePostChatConfirmDelete },
  },
  [PATHS.chatConfirmRewrite]: {
    POST: { auth: "bearer", handle: handlePostChatConfirmRewrite },
  },
};

// Known /v0/* routes and the methods each accepts. OPTIONS is handled globally
// (CORS/PNA preflight) for every route, so it's always listed. Used to answer a
// wrong-method request on a KNOWN path with 405 Method Not Allowed + an `Allow`
// header, instead of the indistinguishable 404 a genuinely unknown path gets —
// so a client can tell "this route exists, wrong method" from "no such route".
// Derived from V0_ROUTES, so the Allow contract can never drift from what the
// dispatch table actually serves.
export const V0_ROUTE_METHODS: Record<string, readonly string[]> =
  Object.fromEntries(
    Object.entries(V0_ROUTES).map(([path, methods]) => [
      path,
      [...Object.keys(methods ?? {}), "OPTIONS"],
    ]),
  );
