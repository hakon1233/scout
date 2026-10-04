// Loopback HTTP server — the ROUTER. Binds to 127.0.0.1 only; never exposed
// to LAN.
//
// This file owns only the cross-cutting request pipeline, in this order:
//   OPTIONS preflight (CORS + classic-PNA) → /healthz liveness →
//   /v0 origin-deny gate → auth per the route's declared kind →
//   exact-match dispatch via routes/index.ts → static UI fallback →
//   405-with-Allow on known paths → styled/JSON 404 →
//   logged 500 catch-all.
// Route BODIES live in routes/*.ts (one module per resource, registered in the
// routes/index.ts dispatch table); shared request plumbing (CORS policy, JSON
// responses, the size-guarded body reader) lives in http-util.ts.
//
// Auth is a bearer token (the pairing token) on the Authorization header.
// The web app reads the same token from local storage after the user pastes
// it into the Connect page. /v0/config alone is same-origin gated instead
// (it BOOTSTRAPS the token), /healthz and /v0/version are public.
//
// State contract: the companion retains exactly one brief at a time
// (`state.last_brief`, "last writer wins"). To keep that slot deterministic,
// POST /v0/interests returns 409 while `last_brief.status === "pending"` —
// callers must wait for the in-flight synth to land before kicking a new one.

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { loadState, STATE_FILE, type State } from "./state.js";
import { PATHS, type Brief, type ChatTurn } from "./contract.js";
import type { ChatDeps } from "./chat.js";
import { defaultChatTranscriptFile } from "./chat-transcript.js";
import { DEFAULT_BUILD_INFO_FILE } from "./build-info.js";
import {
  resolveStatic,
  resolveAppShellFallback,
  trailingSlashRedirect,
} from "./static.js";
import {
  bearer,
  corsHeaders,
  isHostAllowed,
  isOriginDenied,
  isSameOriginCaller,
  json,
  timingSafeTokenEqual,
} from "./http-util.js";

import { V0_ROUTES, V0_ROUTE_METHODS } from "./routes/index.js";
import { handleHealthz } from "./routes/meta.js";
import type { ServerContext } from "./routes/types.js";

export function defaultPort(raw: string | undefined): number {
  if (raw === undefined) return 47821;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 47821;
}

export const DEFAULT_PORT = defaultPort(process.env.SCOUT_AGENT_PORT);

export type ServerDeps = {
  stateFile?: string;
  claudeBin?: string;
  // Injected for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // The synth pass is async; tests can wait on this to know when it finishes.
  onSynthesisDone?: (brief: Brief) => void;
  // Static UI root; defaults to the bundled webroot. Injected for tests.
  webroot?: string;
  // Invoked after PUT /v0/schedule persists a config change, so the running
  // scheduler can re-arm its timer immediately. No-op when absent.
  onScheduleChanged?: () => void | Promise<void>;
  // Per-interest intent-doc directory; defaults to `interests/` beside the state
  // file (in production CONFIG_DIR/interests === docs.ts INTERESTS_DIR). Injected
  // for tests so GET /v0/interests and the synthesis doc-backfill run against a
  // hermetic doc store instead of the real home dir.
  interestsDir?: string;
  // The chat turn is async (kick + poll like briefs); tests wait on this to know
  // when a turn has finished applying its changes.
  onChatDone?: (turn: ChatTurn) => void;
  // Build provenance JSON; defaults to dist/build-info.json baked by
  // scripts/write-build-info.mjs. Injected for tests.
  buildInfoFile?: string;
};

export function createServer(deps: ServerDeps = {}): http.Server {
  const stateFile = deps.stateFile ?? STATE_FILE;
  const claudeBin = deps.claudeBin;
  const spawnFn = deps.spawnFn;
  const webroot = deps.webroot;
  // Default the doc dir to `interests/` beside the state file so a tmp-stateFile
  // test automatically gets a tmp doc dir (the lazy backfill in startRun's
  // synthesis never touches the real ~/.config/scout). In production stateFile
  // is CONFIG_DIR/state.json, so this resolves to CONFIG_DIR/interests ===
  // docs.ts INTERESTS_DIR — exact parity.
  const interestsDir =
    deps.interestsDir ?? path.join(path.dirname(stateFile), "interests");
  const buildInfoFile = deps.buildInfoFile ?? DEFAULT_BUILD_INFO_FILE;
  const chatTranscriptFile = defaultChatTranscriptFile(stateFile);
  const chatDeps: ChatDeps = {
    stateFile,
    interestsDir,
    chatTranscriptFile,
    claudeBin,
    spawnFn,
    onChatDone: deps.onChatDone,
  };
  // Resolved dependencies handed to every route handler. Defaulting
  // happens above, exactly once — handlers never see raw ServerDeps.
  const ctx: ServerContext = {
    stateFile,
    interestsDir,
    buildInfoFile,
    chatDeps,
    claudeBin,
    spawnFn,
    onSynthesisDone: deps.onSynthesisDone,
    onScheduleChanged: deps.onScheduleChanged,
  };

  async function authed(req: http.IncomingMessage): Promise<State | null> {
    const token = bearer(req);
    if (!token) return null;
    const state = await loadState(stateFile);
    if (!timingSafeTokenEqual(state.pairing_token, token)) return null;
    return state;
  }

  return http.createServer((req, res) => {
    // No other page may frame Scout (it holds the pairing token and has
    // destructive buttons), and browsers must trust our content types.
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("content-security-policy", "frame-ancestors 'none'");
    res.setHeader("x-content-type-options", "nosniff");
    const origin = req.headers.origin as string | undefined;
    const cors = corsHeaders(origin);

    if (!isHostAllowed(req.headers.host)) {
      return json(res, 403, { error: "forbidden" });
    }

    if (req.method === "OPTIONS") {
      // Private Network Access (PNA) preflight. Classic-PNA browsers
      // (Chrome ~104–~129 and Chromium forks that haven't shipped Local
      // Network Access yet) send an extra preflight carrying
      // `Access-Control-Request-Private-Network: true` when a public origin
      // (e.g. github.io) fetches this loopback server; they require us to
      // echo `Access-Control-Allow-Private-Network: true` or they deny it.
      // We honor that here for origins we already allow via CORS.
      //
      // IMPORTANT (verified on Chrome 148, 2026-05-30): newer
      // Chrome replaced classic PNA with the *Local Network Access* (LNA)
      // model, which gates public→loopback behind a real USER PERMISSION
      // ("Allow local network"). In that model the request is blocked
      // before any preflight is sent, so this header is a NO-OP and cannot
      // remove the prompt. Removing the prompt requires not making a
      // public→loopback request at all (e.g. serve the UI from the
      // companion on a localhost origin). This header stays as correct,
      // harmless support for classic-PNA browsers — don't assume it solves
      // the LNA prompt.
      const wantsPrivateNetwork =
        req.headers["access-control-request-private-network"] === "true";
      const pna =
        wantsPrivateNetwork && Object.keys(cors).length > 0
          ? { "access-control-allow-private-network": "true" }
          : {};
      res.writeHead(204, { ...cors, ...pna });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    void (async () => {
      try {
        // Liveness sits OUTSIDE the /v0 origin-deny gate below — it must
        // answer no matter who asks.
        if (req.method === "GET" && url.pathname === PATHS.health) {
          return await handleHealthz({ req, res, url, cors }, ctx);
        }

        // Uniform cross-origin deny gate for the whole /v0/* surface. A browser
        // Origin that isn't in the CORS allowlist is rejected with 403 before
        // any route handler runs, so /v0/config, /v0/briefs and /v0/interests
        // all share one origin-deny posture.
        if (url.pathname.startsWith("/v0/") && isOriginDenied(origin)) {
          return json(res, 403, { error: "forbidden" }, cors);
        }

        // Exact-match /v0 dispatch. The router applies each route's
        // declared auth kind BEFORE its handler runs — one uniform auth seam
        // for the entire surface, so no route can drift on it. Unknown paths
        // and known-path/wrong-method requests fall through to the
        // static/405/404 chain below, keeping those contracts untouched.
        const route = V0_ROUTES[url.pathname]?.[req.method ?? ""];
        if (route) {
          if (
            route.auth === "same_origin" &&
            !isSameOriginCaller(
              origin,
              req.headers.host,
              typeof req.headers["sec-fetch-site"] === "string"
                ? req.headers["sec-fetch-site"]
                : undefined,
            )
          ) {
            return json(res, 403, { error: "forbidden" }, cors);
          }
          if (route.auth === "bearer") {
            const state = await authed(req);
            if (!state) return json(res, 401, { error: "unauthorized" }, cors);
            return await route.handle({ req, res, url, cors, state }, ctx);
          }
          return await route.handle({ req, res, url, cors }, ctx);
        }

        // Static UI fallback. Serve the bundled Next export for any GET/HEAD
        // that didn't match an API route. Same-origin with the API above, so
        // the browser never makes a public→loopback request → no LNA prompt.
        if (req.method === "GET" || req.method === "HEAD") {
          // Match Next `trailingSlash: true` / GitHub Pages: 301 a directory
          // route hit without its trailing slash (e.g. /app/connect →
          // /app/connect/) so the companion and github.io behave identically.
          const redirectTo = await trailingSlashRedirect(url.pathname, webroot);
          if (redirectTo) {
            res.writeHead(301, {
              location: redirectTo + url.search,
              "cache-control": "no-cache",
            });
            res.end();
            return;
          }
          // Static export, then SPA fallback to the /app/ shell for unmatched
          // in-app deep-links/refreshes so they don't hard-404.
          const hit =
            (await resolveStatic(url.pathname, webroot)) ??
            (await resolveAppShellFallback(url.pathname, webroot));
          if (hit) {
            res.writeHead(200, {
              "content-type": hit.contentType,
              "content-length": String(hit.body.length),
              // Hashed _next assets are immutable; HTML must revalidate.
              "cache-control": url.pathname.startsWith("/_next/")
                ? "public, max-age=31536000, immutable"
                : "no-cache",
            });
            res.end(req.method === "HEAD" ? undefined : hit.body);
            return;
          }
        }

        // Known route, unsupported method → 405 + Allow (REST-correct), so it's
        // distinguishable from a genuinely unknown path's 404.
        const allowed = V0_ROUTE_METHODS[url.pathname];
        if (allowed) {
          return json(
            res,
            405,
            { error: "method not allowed" },
            { ...cors, allow: allowed.join(", ") },
          );
        }

        // A GET/HEAD for a genuinely-unknown *route* (not caught by the SPA
        // fallback above) should land on the export's styled 404 page with a
        // "← back to your brief" link, not the raw JSON dump a user would
        // otherwise see. Covers browser navigations (Accept: text/html) and
        // bare/`*/*` clients (curl, a directly-typed stray URL) alike — anyone
        // who could be a human. Asset misses (e.g. /app/missing.js — a path
        // with a file extension) and explicit JSON API clients
        // (Accept: application/json without text/html) still get the
        // machine-readable JSON 404.
        if (req.method === "GET" || req.method === "HEAD") {
          const accept = (req.headers.accept as string | undefined) ?? "";
          const wantsJsonOnly =
            accept.includes("application/json") &&
            !accept.includes("text/html");
          const looksLikeAsset = /\.[a-z0-9]+$/i.test(url.pathname);
          if (!wantsJsonOnly && !looksLikeAsset) {
            const page = await resolveStatic("/404.html", webroot);
            if (page) {
              res.writeHead(404, {
                "content-type": page.contentType,
                "content-length": String(page.body.length),
                "cache-control": "no-cache",
              });
              res.end(req.method === "HEAD" ? undefined : page.body);
              return;
            }
          }
        }

        json(res, 404, { error: "not found" }, cors);
      } catch (err) {
        // Last-resort handler for any throw escaping a route: the detail goes
        // to the companion's log, never to the client.
        console.error(
          `[server] unhandled request error: ${req.method} ${url.pathname}:`,
          err,
        );
        json(res, 500, { error: "internal error" }, cors);
      }
    })();
  });
}

export async function startServer(
  port: number = DEFAULT_PORT,
  deps: ServerDeps = {},
): Promise<{ server: http.Server; port: number }> {
  const server = createServer(deps);
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, port: boundPort };
}
