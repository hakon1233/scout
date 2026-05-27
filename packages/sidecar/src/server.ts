// Tiny local-only HTTP proxy. Binds to 127.0.0.1, accepts requests only from
// localhost browser origins, and forwards them to api.anthropic.com / api.exa.ai.
//
// Endpoints:
//   GET  /healthz             — liveness, no auth, no CORS needed
//   POST /anthropic/messages  — proxy to https://api.anthropic.com/v1/messages
//                               using the Claude Code OAuth bearer from the
//                               keychain. Identity system block is prepended
//                               (required for OAuth-bearer requests).
//   POST /exa/search          — proxy to https://api.exa.ai/search using the
//                               local EXA_API_KEY.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { getClaudeOAuthToken, clearCachedToken } from "./auth.js";
import { resolveExaKey } from "./env.js";

export const DEFAULT_PORT = Number(process.env.SCOUT_SIDECAR_PORT ?? 47832);
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const EXA_URL = "https://api.exa.ai/search";

// OAuth bearer requests must look like Claude Code. Anthropic's OAuth-token
// path rejects requests whose system prompt doesn't identify as Claude Code.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

const CORS_ORIGIN_OK = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / curl
  return CORS_ORIGIN_OK.some((rx) => rx.test(origin));
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !originAllowed(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const limit = 2_000_000; // 2MB ceiling — synthesis prompts are well under this.
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error(`Request body too large (>${limit} bytes)`);
    chunks.push(buf);
  }
  if (size === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

type MessagesRequest = {
  model?: string;
  max_tokens?: number;
  system?: string | Array<{ type: string; text: string; cache_control?: unknown }>;
  messages?: Array<{ role: string; content: unknown }>;
  [k: string]: unknown;
};

function prependClaudeCodeIdentity(body: MessagesRequest): MessagesRequest {
  const identityBlock = { type: "text" as const, text: CLAUDE_CODE_IDENTITY };
  if (body.system == null) {
    return { ...body, system: [identityBlock] };
  }
  if (typeof body.system === "string") {
    return {
      ...body,
      system: [identityBlock, { type: "text", text: body.system }],
    };
  }
  if (Array.isArray(body.system)) {
    if (body.system[0]?.text?.startsWith("You are Claude Code")) return body;
    return { ...body, system: [identityBlock, ...body.system] };
  }
  return body;
}

function logUpstream(label: string, info: Record<string, unknown>) {
  // Stay JSON-lineish so log parsers can read it. No PII, no prompt bodies.
  console.log(`[sidecar] ${label} ${JSON.stringify(info)}`);
}

async function handleAnthropic(req: http.IncomingMessage, res: http.ServerResponse) {
  let body: MessagesRequest;
  try {
    body = (await readJsonBody(req)) as MessagesRequest;
  } catch (err) {
    sendJson(res, 400, { error: { type: "bad_request", message: String(err) } });
    return;
  }

  let creds;
  try {
    creds = await getClaudeOAuthToken();
  } catch (err) {
    sendJson(res, 401, {
      error: {
        type: "no_subscription_auth",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  const finalBody = prependClaudeCodeIdentity(body);

  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${creds.accessToken}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": OAUTH_BETA_HEADER,
      },
      body: JSON.stringify(finalBody),
    });
  } catch (err) {
    sendJson(res, 502, {
      error: {
        type: "upstream_unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  const text = await upstream.text();
  if (upstream.status === 401) clearCachedToken();

  // Log model + token usage from the parsed response if available.
  try {
    const parsed = JSON.parse(text) as {
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    logUpstream("anthropic", {
      status: upstream.status,
      model: parsed.model ?? body.model ?? null,
      tokens_in: parsed.usage?.input_tokens ?? null,
      tokens_out: parsed.usage?.output_tokens ?? null,
      ms: Date.now() - started,
    });
  } catch {
    logUpstream("anthropic", {
      status: upstream.status,
      model: body.model ?? null,
      ms: Date.now() - started,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  res.writeHead(upstream.status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function handleExa(req: http.IncomingMessage, res: http.ServerResponse) {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: { type: "bad_request", message: String(err) } });
    return;
  }
  const exaKey = await resolveExaKey();
  if (!exaKey) {
    sendJson(res, 401, {
      error: {
        type: "no_exa_key",
        message:
          "EXA_API_KEY not set. Add it to ~/.scout-sidecar/.env (one line: EXA_API_KEY=exa_...).",
      },
    });
    return;
  }

  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(EXA_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": exaKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    sendJson(res, 502, {
      error: {
        type: "upstream_unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }
  const text = await upstream.text();

  let resultCount: number | null = null;
  try {
    const parsed = JSON.parse(text) as { results?: unknown[] };
    if (Array.isArray(parsed.results)) resultCount = parsed.results.length;
  } catch {
    // ignore — exa returns JSON, but if it doesn't we still proxy verbatim
  }
  const query =
    typeof (body as { query?: unknown }).query === "string"
      ? ((body as { query: string }).query.slice(0, 60))
      : null;
  logUpstream("exa", {
    status: upstream.status,
    query,
    results: resultCount,
    ms: Date.now() - started,
  });

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin);
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);

    if (origin && !originAllowed(origin)) {
      sendJson(res, 403, {
        error: {
          type: "origin_not_allowed",
          message: "Sidecar only accepts requests from http://localhost or http://127.0.0.1.",
        },
      });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, name: "scout-sidecar" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/anthropic/messages") {
      try {
        await handleAnthropic(req, res);
      } catch (err) {
        sendJson(res, 500, {
          error: { type: "internal", message: String(err) },
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/exa/search") {
      try {
        await handleExa(req, res);
      } catch (err) {
        sendJson(res, 500, {
          error: { type: "internal", message: String(err) },
        });
      }
      return;
    }

    sendJson(res, 404, { error: { type: "not_found", path: url.pathname } });
  });
}

export async function listen(port = DEFAULT_PORT): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
