// The /v0 dispatch table (PER-274): pathname → method → route spec.
//
// Adding a route = adding a table entry + a handler module; the router
// (server.ts) supplies origin gating, auth, CORS and error handling uniformly,
// so a new route CANNOT diverge on those. V0_ROUTE_METHODS (the 405 Allow
// contract, PER-136) is derived from this table below — the two can never
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
import type { V0RouteSpec } from "./types.js";

export const V0_ROUTES: Record<
  string,
  Record<string, V0RouteSpec> | undefined
> = {
  "/v0/version": {
    GET: { auth: "none", handle: handleVersion },
  },
  "/v0/config": {
    GET: { auth: "same_origin", handle: handleGetConfig },
  },
  "/v0/interests": {
    GET: { auth: "bearer", handle: handleGetInterests },
    POST: { auth: "bearer", handle: handlePostInterests },
    PUT: { auth: "bearer", handle: handlePutInterests },
  },
  "/v0/briefs": {
    GET: { auth: "bearer", handle: handleGetBriefs },
  },
  "/v0/weekly-brief": {
    POST: { auth: "bearer", handle: handlePostWeeklyBrief },
  },
  "/v0/schedule": {
    GET: { auth: "bearer", handle: handleGetSchedule },
    PUT: { auth: "bearer", handle: handlePutSchedule },
  },
  "/v0/chat": {
    GET: { auth: "bearer", handle: handleGetChat },
    POST: { auth: "bearer", handle: handlePostChat },
  },
  "/v0/chat/stop": {
    POST: { auth: "bearer", handle: handlePostChatStop },
  },
  "/v0/chat/confirm-delete": {
    POST: { auth: "bearer", handle: handlePostChatConfirmDelete },
  },
  "/v0/chat/confirm-rewrite": {
    POST: { auth: "bearer", handle: handlePostChatConfirmRewrite },
  },
};

// Known /v0/* routes and the methods each accepts. OPTIONS is handled globally
// (CORS/PNA preflight) for every route, so it's always listed. Used to answer a
// wrong-method request on a KNOWN path with 405 Method Not Allowed + an `Allow`
// header, instead of the indistinguishable 404 a genuinely unknown path gets —
// so a client can tell "this route exists, wrong method" from "no such route".
// (PER-136) Derived from V0_ROUTES since the PER-274 split, so the Allow
// contract can never drift from what the dispatch table actually serves.
export const V0_ROUTE_METHODS: Record<string, readonly string[]> =
  Object.fromEntries(
    Object.entries(V0_ROUTES).map(([path, methods]) => [
      path,
      [...Object.keys(methods ?? {}), "OPTIONS"],
    ]),
  );
