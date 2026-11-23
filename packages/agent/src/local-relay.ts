// The Mac's side of the local account relay (docs/ARCHITECTURE.md, "Local
// account relay" and "Local Scout on the Mac"): a local account
// (profiles.runs_local) makes no Claude API calls, so every model step the
// Worker would send is answered here by the local `claude`, through
// claude-runner.ts.
//
// - answerRelayPrompt: one RelayPrompt -> RelayAnswer (no tools, Haiku, 90 s,
//   the request's JSON schema as `--json-schema`). The team runner's picks use
//   it directly (team-runner.ts).
// - createWorkerProxy: the gateway's Worker half (scripts/local-gateway.mts).
//   The browser's POSTs go to the Worker server to server; `/chat` and
//   `/publish` go through the relay's prompt and answer steps, one turn at a
//   time, and the browser gets the Worker's final answer unchanged.
//
// Not part of the companion: the companion never imports this module. The
// relay token is never printed or sent to the browser.

import type { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  PUBLISH_PATH,
  RELAY_HEADER,
  RELAY_TOKEN_HEADER,
  type RelayAnswer,
  type RelayModelRequest,
  type RelayPrompt,
} from "#core";
import { runClaude, USAGE_LIMIT_RE } from "./claude-runner.js";

export type RelayClaudeDeps = {
  claudeBin?: string;
  spawnFn?: typeof spawn;
  timeoutMs?: number;
};

// A chat turn's or a publish check's answer is short; the reader waits.
export const RELAY_TIMEOUT_MS = 90 * 1000;
export const RELAY_MODEL = "haiku";

// The request's messages as one prompt: its text blocks, and with more than
// one message, who said each.
export function relayPromptText(request: RelayModelRequest): string {
  const textOf = (m: RelayModelRequest["messages"][number]) =>
    m.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n\n");
  if (request.messages.length === 1) return textOf(request.messages[0]);
  return request.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${textOf(m)}`)
    .join("\n\n");
}

// Runs one relay prompt through the local `claude`. Rejects as runClaude does.
export async function answerRelayPrompt(
  prompt: RelayPrompt,
  deps: RelayClaudeDeps = {},
): Promise<RelayAnswer> {
  const out = await runClaude(relayPromptText(prompt.request), {
    tools: "none",
    label: "relay answer",
    model: RELAY_MODEL,
    jsonSchema: prompt.request.output_config?.format?.schema,
    timeoutMs: deps.timeoutMs ?? RELAY_TIMEOUT_MS,
    claudeBin: deps.claudeBin,
    spawnFn: deps.spawnFn,
  });
  const u = out.usage;
  return {
    turnId: prompt.turnId,
    text: out.text,
    ...(u
      ? {
          usage: {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            cacheReadTokens: u.cacheReadTokens,
            cacheWriteTokens: u.cacheWriteTokens,
          },
        }
      : {}),
  };
}

// What the reader reads when the Mac's `claude` could not answer.
export function relayFailureMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (USAGE_LIMIT_RE.test(msg))
    return "Claude on your Mac has reached its usage limit. Try again later.";
  if (/timed out/.test(msg))
    return "Claude on your Mac took too long to answer. Try again.";
  return "Claude on your Mac couldn't answer. Try again.";
}

export type WorkerProxyDeps = RelayClaudeDeps & {
  // The real Worker, e.g. https://scout-runs.<account>.workers.dev
  workerUrl: string;
  token: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
};

// Paths whose POST goes through the relay.
const RELAYED = new Set(["/chat", PUBLISH_PATH]);

// Request headers never forwarded: hop-by-hop, the gateway's own host, and
// relay headers a browser might try to set.
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "cookie",
  RELAY_HEADER,
  RELAY_TOKEN_HEADER,
]);
// fetch has already decoded the body; the gateway sends its own length.
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  RELAY_HEADER,
]);

type Reply = { status: number; headers: Headers | null; body: Buffer };

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const jsonReply = (status: number, body: unknown): Reply => ({
  status,
  headers: null,
  body: Buffer.from(JSON.stringify(body)),
});

// The gateway's Worker half: a Node request handler. Every request it gets
// goes to the Worker; the static site is the caller's.
export function createWorkerProxy(deps: WorkerProxyDeps) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? ((line: string) => console.log(line));
  const base = deps.workerUrl.replace(/\/+$/, "");
  // One `claude` at a time: each turn waits for the one before.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  async function toWorker(
    method: string,
    pathAndQuery: string,
    headers: Record<string, string>,
    body: Buffer | undefined,
  ): Promise<Reply> {
    const res = await doFetch(base + pathAndQuery, {
      method,
      headers,
      body: body && body.length ? new Uint8Array(body) : undefined,
      redirect: "manual",
    });
    return {
      status: res.status,
      headers: res.headers,
      body: Buffer.from(await res.arrayBuffer()),
    };
  }

  async function relay(
    pathAndQuery: string,
    headers: Record<string, string>,
    body: Buffer,
  ): Promise<Reply> {
    const step = (s: "prompt" | "answer") => ({
      ...headers,
      [RELAY_HEADER]: s,
      [RELAY_TOKEN_HEADER]: deps.token,
    });
    const first = await toWorker("POST", pathAndQuery, step("prompt"), body);
    // No model call was needed (a limit, a refusal, an error): as it is.
    if (first.status !== 200 || first.headers?.get(RELAY_HEADER) !== "prompt")
      return first;
    let prompt: RelayPrompt;
    try {
      prompt = JSON.parse(first.body.toString("utf8")) as RelayPrompt;
      if (!prompt.turnId || !prompt.request?.messages) throw new Error();
    } catch {
      return jsonReply(502, { error: "Scout's server sent a bad answer." });
    }
    let answer: RelayAnswer;
    try {
      answer = await serial(() => answerRelayPrompt(prompt, deps));
    } catch (err) {
      log(
        `relay ${pathAndQuery}: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
      );
      return jsonReply(503, { error: relayFailureMessage(err) });
    }
    return toWorker(
      "POST",
      pathAndQuery,
      { ...step("answer"), "content-type": "application/json" },
      Buffer.from(JSON.stringify(answer)),
    );
  }

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const pathAndQuery = req.url ?? "/";
    const pathname = new URL(pathAndQuery, "http://local").pathname;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || DROP_REQUEST.has(name)) continue;
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    let reply: Reply;
    try {
      const body =
        method === "GET" || method === "HEAD" ? undefined : await readBody(req);
      reply =
        method === "POST" && RELAYED.has(pathname)
          ? await relay(pathAndQuery, headers, body ?? Buffer.alloc(0))
          : await toWorker(method, pathAndQuery, headers, body);
    } catch (err) {
      log(
        `proxy ${method} ${pathname}: ${err instanceof Error ? err.message : String(err)}`,
      );
      reply = jsonReply(502, {
        error: "Scout's server can't be reached right now. Try again later.",
      });
    }
    const out: Record<string, string> = {};
    if (reply.headers) {
      reply.headers.forEach((value, name) => {
        if (!DROP_RESPONSE.has(name)) out[name] = value;
      });
    } else out["content-type"] = "application/json";
    out["content-length"] = String(reply.body.length);
    res.writeHead(reply.status, out);
    res.end(method === "HEAD" ? undefined : reply.body);
  };
}
