// The one place the companion starts a headless `claude` child.
//
// The prompt goes over stdin. stdout is the CLI's json result
// (`--output-format json`): the answer's text plus what the session used. We
// never read or forward the user's Claude credentials: the CLI authenticates
// itself.
//
// Security: research feeds the model untrusted web pages, so a page can try
// prompt injection. Each run therefore gets an explicit, minimal tool set via
// `--tools` (which removes every other built-in tool, unlike `--allowed-tools`,
// which only pre-approves), no MCP servers, no permission bypass, and the temp
// dir as its working directory. It also starts without the user's own Claude
// Code setup (`--safe-mode` drops CLAUDE.md, skills, plugins and hooks;
// `--setting-sources ""` drops their settings files) and with only the
// environment it needs, so nothing private sits in a session a page can steer.

import { spawn } from "node:child_process";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { CliUsage } from "#core";

// "web-research": WebSearch + WebFetch only. "none": no tools at all.
type ClaudeTools = "web-research" | "none";

export type ClaudeRunOptions = {
  tools: ClaudeTools;
  // Names the run in the timeout error, e.g. `claude session for "ai"`.
  label?: string;
  claudeBin?: string;
  // Test seam: a stub `claude` without the real binary or network.
  spawnFn?: typeof spawn;
  // Hard per-run ceiling; defaults to SCOUT_SESSION_TIMEOUT_MS or 4 min.
  timeoutMs?: number;
  // Kills the child and rejects with an AbortError.
  signal?: AbortSignal;
  // Caps a web-research session's agentic turns (`--max-turns`): each search
  // or fetch takes one. Unset, MAX_RESEARCH_TURNS.
  maxTurns?: number;
};

// A research run that keeps searching ends instead of looping. A real run
// takes 5-15 turns.
const MAX_RESEARCH_TURNS = 25;

const TOOL_ARGS: Record<ClaudeTools, string[]> = {
  "web-research": [
    "--tools",
    "WebSearch,WebFetch",
    // Pre-approve both so `--print` never stops at a permission prompt.
    "--allowed-tools",
    "WebSearch,WebFetch",
  ],
  none: ["--tools", ""],
};

// Variables the child may inherit: enough to run, sign in (an API key, an OAuth
// token, a cloud provider, a proxy) and, for the companion's own SCOUT_*
// settings, to let the e2e stub find its port. Everything else stays out.
const ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUD_ML_REGION",
]);
const ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "AWS_", "SCOUT_"];

function childEnv(): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ENV_NAMES.has(name) || ENV_PREFIXES.some((p) => name.startsWith(p)),
    ),
  );
  // Needed under the root tsconfig, where Next's types make NODE_ENV required;
  // lint sees only this package's tsconfig and calls it unnecessary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return kept as NodeJS.ProcessEnv;
}

// How the CLI words a usage or rate limit in its error output.
export const USAGE_LIMIT_RE =
  /usage limit|rate limit|limit reached|too many requests|\b429\b|resets? at/i;

// Lower the child's priority so the CPU-heavy model loop cannot starve the
// single-threaded loopback server and stall the UI's polling. Advisory only.
const CHILD_NICENESS = 10;

// A real run takes 1-3 minutes. The ceiling turns a hung child (model stall,
// network wedge) into a normal failure instead of blocking the run loop.
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

function timeoutMs(override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return override;
  }
  const env = Number(process.env.SCOUT_SESSION_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function abortError(): Error {
  const err = new Error("claude run aborted");
  err.name = "AbortError";
  return err;
}

// A session's answer and, when the CLI printed its json result, its usage.
export type ClaudeOutput = { text: string; usage: CliUsage | null };

// A count from the json: a finite number of at least zero, else 0.
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

// Reads `claude --print --output-format json`: one result object. Anything
// else (plain text from an older CLI or a stub, a cut-off object) comes back
// as the text, unchanged, with no usage. `failed` marks a result the CLI
// flagged as an error; `detail` is its own words for it.
export function parseCliOutput(
  stdout: string,
): ClaudeOutput & { failed: boolean; detail: string } {
  const raw = { text: stdout, usage: null, failed: false, detail: "" };
  let json: Record<string, unknown> | null;
  try {
    json = record(JSON.parse(stdout));
  } catch {
    return raw;
  }
  if (!json || json.type !== "result") return raw;

  const text = typeof json.result === "string" ? json.result : "";
  const total = record(json.usage) ?? {};
  const tools = record(total.server_tool_use) ?? {};
  const models = Object.entries(record(json.modelUsage) ?? {}).flatMap(
    ([name, u]) => (record(u) ? [{ name, u: record(u)! }] : []),
  );
  // Every model the session used (the CLI's own side calls too), else the
  // result's totals.
  const sum = (modelKey: string, totalKey: string) =>
    models.length
      ? models.reduce((n, m) => n + count(m.u[modelKey]), 0)
      : count(total[totalKey]);
  const main = models.reduce<{ name: string; out: number } | null>(
    (best, m) =>
      !best || count(m.u.outputTokens) > best.out
        ? { name: m.name, out: count(m.u.outputTokens) }
        : best,
    null,
  );
  const fetches = tools.web_fetch_requests;
  const usage: CliUsage = {
    model: main?.name ?? null,
    stopReason: typeof json.stop_reason === "string" ? json.stop_reason : null,
    turns: count(json.num_turns),
    inputTokens: sum("inputTokens", "input_tokens"),
    outputTokens: sum("outputTokens", "output_tokens"),
    cacheReadTokens: sum("cacheReadInputTokens", "cache_read_input_tokens"),
    cacheWriteTokens: sum(
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
    ),
    webSearches: models.length
      ? sum("webSearchRequests", "")
      : count(tools.web_search_requests),
    webFetches: typeof fetches === "number" ? count(fetches) : null,
    costUsd: count(json.total_cost_usd),
  };
  const errors = Array.isArray(json.errors)
    ? json.errors.filter((e): e is string => typeof e === "string" && !!e)
    : [];
  const detail =
    text.trim() ||
    errors.join("; ") ||
    (typeof json.subtype === "string" ? json.subtype : "");
  return { text, usage, failed: json.is_error === true, detail };
}

// Two runs' usage added up; null when neither reported any. The model and
// stop reason are the latest session's.
export function addCliUsage(
  a: CliUsage | null,
  b: CliUsage | null,
): CliUsage | null {
  if (!a || !b) return a ?? b;
  return {
    model: b.model ?? a.model,
    stopReason: b.stopReason ?? a.stopReason,
    turns: a.turns + b.turns,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
    webFetches:
      a.webFetches === null && b.webFetches === null
        ? null
        : (a.webFetches ?? 0) + (b.webFetches ?? 0),
    costUsd: a.costUsd + b.costUsd,
  };
}

// Resolves with the session's text and usage on exit 0. Rejects on a non-zero exit
// or a result the CLI flagged as an error (`claude exited <code>: <detail>`),
// a spawn failure, the timeout (`<label> timed out after <ms>ms`) or an abort
// (name `AbortError`).
export function runClaude(
  prompt: string,
  opts: ClaudeRunOptions,
): Promise<ClaudeOutput> {
  const claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ?? "claude";
  const spawnImpl = opts.spawnFn ?? spawn;
  const limitMs = timeoutMs(opts.timeoutMs);
  const label = opts.label ?? "claude run";
  const { signal } = opts;

  return new Promise<ClaudeOutput>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());

    const child = spawnImpl(
      claudeBin,
      [
        "--print",
        "--output-format",
        "json",
        ...TOOL_ARGS[opts.tools],
        ...(opts.tools === "web-research"
          ? ["--max-turns", String(opts.maxTurns ?? MAX_RESEARCH_TURNS)]
          : []),
        "--strict-mcp-config",
        "--safe-mode",
        "--setting-sources",
        "",
        // The child no longer reads the reader's settings, so a model choice
        // has to come from here. Unset, the CLI's default model is used.
        ...(process.env.SCOUT_CLAUDE_MODEL
          ? ["--model", process.env.SCOUT_CLAUDE_MODEL]
          : []),
      ],
      { stdio: ["pipe", "pipe", "pipe"], cwd: os.tmpdir(), env: childEnv() },
    );

    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, CHILD_NICENESS);
      } catch {
        // Proceed without the niceness hedge.
      }
    }

    // Exactly one outcome wins: close, error, timeout or abort.
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    // Stub children in tests may have no kill().
    const kill = (sig: NodeJS.Signals) =>
      (child as { kill?: (s?: NodeJS.Signals) => void }).kill?.(sig);
    // SIGTERM first, then SIGKILL in case the CLI's own tools swallow the term.
    const terminate = () => {
      try {
        kill("SIGTERM");
        setTimeout(() => {
          try {
            kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, 2000).unref?.();
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(
      () =>
        settle(() => {
          terminate();
          reject(new Error(`${label} timed out after ${limitMs}ms`));
        }),
      limitMs,
    );
    const onAbort = () =>
      settle(() => {
        terminate();
        reject(abortError());
      });
    signal?.addEventListener("abort", onAbort, { once: true });

    // A StringDecoder keeps a multi-byte character that straddles two chunks
    // intact; per-chunk Buffer.toString() would corrupt it.
    let stdout = "";
    let stderr = "";
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    child.stdout.on("data", (b: Buffer) => (stdout += outDecoder.write(b)));
    child.stderr.on("data", (b: Buffer) => (stderr += errDecoder.write(b)));

    child.on("error", (e) =>
      settle(() =>
        reject(
          new Error(
            `failed to spawn '${claudeBin}' — is the Claude Code CLI installed and on PATH? (${e.message})`,
          ),
        ),
      ),
    );
    child.on("close", (code) =>
      settle(() => {
        stdout += outDecoder.end();
        stderr += errDecoder.end();
        if (signal?.aborted) return reject(abortError());
        const out = parseCliOutput(stdout);
        if (code !== 0 || out.failed) {
          // The CLI reports some failures (e.g. a usage cap) on stdout with an
          // empty stderr, so fall back to stdout to keep the cause visible:
          // the json result's own words, never the json itself.
          const detail = (
            stderr.trim() ||
            out.detail.trim() ||
            stdout.trim()
          ).slice(0, 400);
          // A CLI older than the flags above refuses them before doing anything.
          const hint = /unknown option/.test(detail)
            ? " — update Claude Code (`claude update`) and try again"
            : "";
          return reject(new Error(`claude exited ${code}: ${detail}${hint}`));
        }
        resolve({ text: out.text, usage: out.usage });
      }),
    );

    // If the CLI exits before reading the whole prompt, the write fails with
    // EPIPE. Unhandled, that would crash the server; the close/error handlers
    // above already report the real cause.
    child.stdin.on("error", (e: Error) =>
      console.error(`[claude-runner] stdin write failed:`, e.message),
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
