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

export const PKG_VERSION = "0.3.0";
export const DEFAULT_PORT = Number(process.env.SCOUT_AGENT_PORT ?? 47821);

export type ServerDeps = {
  stateFile?: string;
  claudeBin?: string;
  // Injected for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // The synth pass is async; tests can wait on this to know when it finishes.
  onSynthesisDone?: (brief: Brief) => void;
};

const CORS_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/scout\.[a-z.]+$/,
  /^https:\/\/[a-z0-9-]+\.github\.io$/,
];

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

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
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
      res.writeHead(204, cors);
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

        if (req.method === "POST" && url.pathname === "/v0/interests") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const body = await readBody(req);
          let parsed: { interests?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const interests = Array.isArray(parsed.interests)
            ? (parsed.interests as unknown[])
                .filter((s): s is string => typeof s === "string")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          if (interests.length === 0)
            return json(res, 400, { error: "interests required" }, cors);
          if (interests.length > 6)
            return json(
              res,
              400,
              { error: "too many interests, max 6" },
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
