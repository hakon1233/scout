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

import http from "node:http";
import { URL } from "node:url";
import {
  loadState,
  newBriefId,
  saveState,
  STATE_FILE,
  type Article,
  type Brief,
  type State,
} from "./state.js";
import { exaSearch, type Fetcher } from "./exa.js";
import { synthesizeWithClaude } from "./synthesize.js";

export const PKG_VERSION = "0.2.0";
export const DEFAULT_PORT = Number(process.env.NOTIVA_AGENT_PORT ?? 47821);

export type ServerDeps = {
  stateFile?: string;
  exaFetcher?: Fetcher;
  claudeBin?: string;
  // The synth pass is async; tests can wait on this to know when it finishes.
  onSynthesisDone?: (brief: Brief) => void;
};

const CORS_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/notiva\.[a-z.]+$/,
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
  const exaFetcher = deps.exaFetcher;
  const claudeBin = deps.claudeBin;

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
                .slice(0, 6)
            : [];
          if (interests.length === 0)
            return json(res, 400, { error: "interests required" }, cors);
          if (!state.exa_key)
            return json(
              res,
              412,
              {
                error: "missing exa_key",
                hint: "add `exa_key` to ~/.config/notiva/state.json",
              },
              cors,
            );

          const briefId = newBriefId();
          const pending: Brief = {
            id: briefId,
            generated_at: new Date().toISOString(),
            status: "pending",
            articles: [],
          };
          await saveState({ ...state, last_brief: pending }, stateFile);

          // Fire and forget — the web app polls /v0/briefs to see when it lands.
          void runSynthesis({
            interests,
            briefId,
            state,
            stateFile,
            exaFetcher,
            claudeBin,
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
  state: State;
  stateFile: string;
  exaFetcher?: Fetcher;
  claudeBin?: string;
  onSynthesisDone?: (brief: Brief) => void;
}): Promise<void> {
  const { interests, briefId, state, stateFile, exaFetcher, claudeBin } = args;
  let brief: Brief = {
    id: briefId,
    generated_at: new Date().toISOString(),
    status: "pending",
    articles: [],
  };

  try {
    const articles: Article[] = [];
    for (const topic of interests) {
      const results = await exaSearch(topic, state.exa_key!, exaFetcher);
      for (const r of results) {
        articles.push({
          interest: topic,
          title: r.title ?? r.url,
          url: r.url,
          snippet: r.text?.slice(0, 600),
          published: r.publishedDate,
        });
      }
    }
    const summary = await synthesizeWithClaude(interests, articles, claudeBin);
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "ready",
      summary_md: summary,
      articles,
    };
  } catch (err) {
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "failed",
      error_msg: String(err),
      articles: [],
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
