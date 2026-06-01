// Loopback HTTP server. Binds to 127.0.0.1 only; never exposed to LAN.
//
// Endpoints:
//   GET  /healthz                — liveness, no auth
//   POST /v0/interests           — kick a synthesis pass (auth)
//   GET  /v0/briefs?since=<iso>  — list briefs generated since <iso> (auth)
//
// Auth is a bearer token (the pairing token) on the Authorization header.
// The web app reads the same token from local storage after the user pastes
// it into the Connect page.
//
// State contract: the companion retains exactly one brief at a time
// (`state.last_brief`, "last writer wins"). To keep that slot deterministic,
// POST /v0/interests returns 409 while `last_brief.status === "pending"` —
// callers must wait for the in-flight synth to land before kicking a new one.

import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import {
  loadState,
  newBriefId,
  saveState,
  STATE_FILE,
  type Brief,
  type State,
} from "./state.js";
import { researchAndSynthesize } from "./research.js";
import { resolveStatic, resolveAppShellFallback, trailingSlashRedirect } from "./static.js";

export const PKG_VERSION = "0.3.0";
export const DEFAULT_PORT = Number(process.env.SCOUT_AGENT_PORT ?? 47821);

export type ServerDeps = {
  stateFile?: string;
  claudeBin?: string;
  // Injected for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // The synth pass is async; tests can wait on this to know when it finishes.
  onSynthesisDone?: (brief: Brief) => void;
  // Static UI root; defaults to the bundled webroot. Injected for tests.
  webroot?: string;
};

const CORS_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/scout\.[a-z.]+$/,
  /^https:\/\/[a-z0-9-]+\.github\.io$/,
];

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// True when the request is same-origin with this loopback server: either no
// Origin header (browsers omit it for same-origin GETs) or an explicit
// loopback origin. Used to gate `/v0/config`, which hands the page its pairing
// token — only the UI we serve (same-origin) should get it.
function isSameOriginCaller(origin: string | undefined): boolean {
  return !origin || LOOPBACK_ORIGIN.test(origin);
}

// True when a browser Origin is present but is NOT in our CORS allowlist. Such
// a caller has no legitimate business touching any /v0/* route, so we 403 it
// uniformly across the whole surface (defense in depth) instead of serving a
// no-ACAO 200 the browser would block from reading anyway. This keeps the
// origin-deny posture consistent: previously only /v0/config rejected a hostile
// Origin while /v0/briefs and /v0/interests served it. (PER-135)
//
// No-Origin callers (non-browser clients, or same-origin GETs where the browser
// omits Origin) pass this gate and remain subject to bearer auth. Allowlisted
// app origins (the hosted UI on github.io / vercel.app) also pass, since briefs
// and interests are designed to be called cross-origin by that UI. /v0/config
// stays stricter still — same-origin only — via isSameOriginCaller.
function isOriginDenied(origin: string | undefined): boolean {
  if (!origin) return false;
  return !CORS_ALLOWED_ORIGINS.some((rx) => rx.test(origin));
}

// Known /v0/* routes and the methods each accepts. OPTIONS is handled globally
// (CORS/PNA preflight) for every route, so it's always listed. Used to answer a
// wrong-method request on a KNOWN path with 405 Method Not Allowed + an `Allow`
// header, instead of the indistinguishable 404 a genuinely unknown path gets —
// so a client can tell "this route exists, wrong method" from "no such route".
// (PER-136)
const V0_ROUTE_METHODS: Record<string, readonly string[]> = {
  "/v0/config": ["GET", "OPTIONS"],
  "/v0/interests": ["POST", "OPTIONS"],
  "/v0/briefs": ["GET", "OPTIONS"],
};

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  if (!CORS_ALLOWED_ORIGINS.some((rx) => rx.test(origin))) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

// Request-body and per-interest bounds. The count is already capped at 6; these
// cap the remaining unbounded dimensions so an oversized body can't blow the
// companion's memory or get forwarded into the (expensive, ~5-min) Claude
// synthesis prompt. (PER-137)
//
// 16 KiB comfortably holds 6 interests of 200 chars each plus JSON framing and
// any whitespace/unicode escaping, with generous headroom.
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_INTEREST_LEN = 200;

// Thrown by readBody when the request body exceeds MAX_BODY_BYTES, so the
// handler can answer 413 instead of buffering an unbounded body into memory.
export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

async function readBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += buf.length;
    if (total > maxBytes) {
      // Stop buffering and tear down the connection so we never hold the whole
      // oversized payload in memory.
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function createServer(deps: ServerDeps = {}): http.Server {
  const stateFile = deps.stateFile ?? STATE_FILE;
  const claudeBin = deps.claudeBin;
  const spawnFn = deps.spawnFn;
  const webroot = deps.webroot;

  async function authed(req: http.IncomingMessage): Promise<State | null> {
    const token = bearer(req);
    if (!token) return null;
    const state = await loadState(stateFile);
    if (!state.pairing_token || state.pairing_token !== token) return null;
    return state;
  }

  return http.createServer((req, res) => {
    const origin = req.headers.origin as string | undefined;
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      // Private Network Access (PNA) preflight. Classic-PNA browsers
      // (Chrome ~104–~129 and Chromium forks that haven't shipped Local
      // Network Access yet) send an extra preflight carrying
      // `Access-Control-Request-Private-Network: true` when a public origin
      // (e.g. github.io) fetches this loopback server; they require us to
      // echo `Access-Control-Allow-Private-Network: true` or they deny it.
      // We honor that here for origins we already allow via CORS.
      //
      // IMPORTANT (verified on Chrome 148, 2026-05-30, PER-107): newer
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
        if (req.method === "GET" && url.pathname === "/healthz") {
          json(res, 200, { ok: true, version: PKG_VERSION }, cors);
          return;
        }

        // Uniform cross-origin deny gate for the whole /v0/* surface. A browser
        // Origin that isn't in the CORS allowlist is rejected with 403 before
        // any route handler runs, so /v0/config, /v0/briefs and /v0/interests
        // all share one origin-deny posture. (PER-135)
        if (url.pathname.startsWith("/v0/") && isOriginDenied(origin)) {
          return json(res, 403, { error: "forbidden" }, cors);
        }

        // Same-origin bootstrap: hand the served UI its pairing token so the
        // user never has to copy/paste it. When the page is served from this
        // companion (http://127.0.0.1:47821/), the fetch is same-origin and
        // this returns the token. A cross-origin (public) caller is refused —
        // and is in any case blocked by the browser's LNA gate before it ever
        // reaches us. The token only guards the browser-origin boundary; any
        // local process can already read ~/.config/scout/state.json, so this
        // adds no on-machine exposure.
        if (req.method === "GET" && url.pathname === "/v0/config") {
          if (!isSameOriginCaller(origin)) {
            return json(res, 403, { error: "forbidden" }, cors);
          }
          const state = await loadState(stateFile);
          json(
            res,
            200,
            { token: state.pairing_token ?? null, version: PKG_VERSION },
            cors,
          );
          return;
        }

        if (req.method === "POST" && url.pathname === "/v0/interests") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          // Fast reject on a declared oversized body before reading it at all.
          const declaredLen = Number(req.headers["content-length"]);
          if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
            return json(res, 413, { error: "request body too large" }, cors);
          }
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: { interests?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const cleaned = Array.isArray(parsed.interests)
            ? (parsed.interests as unknown[])
                .filter((s): s is string => typeof s === "string")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          // De-duplicate before counting against the max-6 budget. Match on a
          // case-insensitive key so "AI safety"/"ai safety" collapse the way the
          // rendered brief already does (one `## AI safety` section), but keep
          // the first occurrence's original casing for display. (PER-126)
          const seen = new Set<string>();
          const interests = cleaned.filter((s) => {
            const key = s.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (interests.length === 0)
            return json(res, 400, { error: "interests required" }, cors);
          if (interests.length > 6)
            return json(
              res,
              400,
              { error: "too many interests, max 6" },
              cors,
            );
          // Cap each interest's length. The count and total body are already
          // bounded; this stops a single in-budget interest from being a
          // multi-KB blob forwarded into the synthesis prompt. (PER-137)
          if (interests.some((s) => s.length > MAX_INTEREST_LEN))
            return json(
              res,
              400,
              { error: `interest too long, max ${MAX_INTEREST_LEN} chars` },
              cors,
            );

          // One brief slot, last-writer-wins. Reject a second kick while the
          // previous run is still pending so we don't silently overwrite it.
          if (state.last_brief?.status === "pending") {
            return json(
              res,
              409,
              {
                error: "brief in progress",
                brief_id: state.last_brief.id,
              },
              cors,
            );
          }

          const briefId = newBriefId();
          const pending: Brief = {
            id: briefId,
            generated_at: new Date().toISOString(),
            status: "pending",
          };
          await saveState({ ...state, last_brief: pending }, stateFile);

          // Fire and forget — the web app polls /v0/briefs to see when it lands.
          void runSynthesis({
            interests,
            briefId,
            stateFile,
            claudeBin,
            spawnFn,
            onSynthesisDone: deps.onSynthesisDone,
          });

          json(res, 202, { brief_id: briefId, status: "pending" }, cors);
          return;
        }

        if (req.method === "GET" && url.pathname === "/v0/briefs") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const since = url.searchParams.get("since");
          const last = state.last_brief;
          const matches = last && (!since || last.generated_at > since) ? [last] : [];
          json(res, 200, { briefs: matches }, cors);
          return;
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
          // in-app deep-links/refreshes so they don't hard-404 (PER-127).
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
        // distinguishable from a genuinely unknown path's 404. (PER-136)
        const allowed = V0_ROUTE_METHODS[url.pathname];
        if (allowed) {
          return json(
            res,
            405,
            { error: "method not allowed" },
            { ...cors, allow: allowed.join(", ") },
          );
        }

        json(res, 404, { error: "not found" }, cors);
      } catch (err) {
        json(res, 500, { error: String(err) }, cors);
      }
    })();
  });
}

async function runSynthesis(args: {
  interests: string[];
  briefId: string;
  stateFile: string;
  claudeBin?: string;
  spawnFn?: typeof spawn;
  onSynthesisDone?: (brief: Brief) => void;
}): Promise<void> {
  const { interests, briefId, stateFile, claudeBin, spawnFn } = args;
  let brief: Brief;

  try {
    const summary = await researchAndSynthesize(interests, { claudeBin, spawnFn });
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "ready",
      summary_md: summary,
    };
  } catch (err) {
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "failed",
      error_msg: String(err),
    };
  }

  const fresh = await loadState(stateFile);
  await saveState({ ...fresh, last_brief: brief }, stateFile);
  args.onSynthesisDone?.(brief);
}

export async function startServer(
  port: number = DEFAULT_PORT,
  deps: ServerDeps = {},
): Promise<{ server: http.Server; port: number }> {
  const server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, port: boundPort };
}
