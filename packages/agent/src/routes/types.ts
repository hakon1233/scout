// Route-dispatch types for the PER-274 server decomposition.
//
// The `auth` discriminant is the load-bearing part: the ROUTER (server.ts)
// enforces it before any handler runs, so no /v0 route can drift on auth.
// "bearer" handlers are typed to receive the already-token-verified State and
// therefore cannot even be written to skip the check — the H2 audit risk was
// exactly "easy for a new route to diverge on limits/auth".

import type http from "node:http";
import type { spawn } from "node:child_process";
import type { Brief, State } from "../state.js";
import type { ChatDeps } from "../chat.js";

// Per-server dependencies (ServerDeps with defaults applied), built once in
// createServer and threaded to every handler. Handlers never see raw
// ServerDeps — the defaulting happens in exactly one place.
export type ServerContext = {
  stateFile: string;
  interestsDir: string;
  buildInfoFile: string;
  chatDeps: ChatDeps;
  claudeBin?: string;
  spawnFn?: typeof spawn;
  onSynthesisDone?: (brief: Brief) => void;
  onScheduleChanged?: () => void | Promise<void>;
};

// Per-request envelope every handler receives. `cors` is precomputed by the
// router from the Origin header so every response carries identical CORS
// headers no matter which handler writes it.
export type RequestContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  cors: Record<string, string>;
};

// A bearer-authed request additionally carries the loaded state whose
// pairing_token matched the Authorization header — the router already did the
// 401 check by the time a bearer handler runs.
export type AuthedRequestContext = RequestContext & { state: State };

// Auth kinds, applied by the router:
//   "none"        — public provenance routes (/v0/version).
//   "same_origin" — /v0/config: only the UI this server itself serves may read
//                   the pairing token (isSameOriginCaller), else 403.
//   "bearer"      — everything else: pairing-token bearer auth, else 401.
export type V0RouteSpec =
  | {
      auth: "none" | "same_origin";
      handle: (rc: RequestContext, sc: ServerContext) => Promise<void>;
    }
  | {
      auth: "bearer";
      handle: (rc: AuthedRequestContext, sc: ServerContext) => Promise<void>;
    };
