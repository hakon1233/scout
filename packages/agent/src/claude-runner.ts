// The one place the companion starts a headless `claude` child.
//
// The prompt goes over stdin and stdout comes back as text. We never read or
// forward the user's Claude credentials: the CLI authenticates itself.
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

// "web-research": WebSearch + WebFetch only. "none": no tools at all.
export type ClaudeTools = "web-research" | "none";

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
};

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
  return kept as NodeJS.ProcessEnv;
}

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

// Resolves with the child's raw stdout on exit 0. Rejects on a non-zero exit
// (`claude exited <code>: <detail>`), a spawn failure, the timeout
// (`<label> timed out after <ms>ms`) or an abort (name `AbortError`).
export function runClaude(
  prompt: string,
  opts: ClaudeRunOptions,
): Promise<string> {
  const claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ?? "claude";
  const spawnImpl = opts.spawnFn ?? spawn;
  const limitMs = timeoutMs(opts.timeoutMs);
  const label = opts.label ?? "claude run";
  const { signal } = opts;

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());

    const child = spawnImpl(
      claudeBin,
      [
        "--print",
        "--output-format",
        "text",
        ...TOOL_ARGS[opts.tools],
        "--strict-mcp-config",
        "--safe-mode",
        "--setting-sources",
        "",
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
    child.stdout!.on("data", (b: Buffer) => (stdout += outDecoder.write(b)));
    child.stderr!.on("data", (b: Buffer) => (stderr += errDecoder.write(b)));

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
        if (code !== 0) {
          // The CLI reports some failures (e.g. a usage cap) on stdout with an
          // empty stderr, so fall back to stdout to keep the cause visible.
          const detail = (stderr.trim() || stdout.trim()).slice(0, 400);
          return reject(new Error(`claude exited ${code}: ${detail}`));
        }
        resolve(stdout);
      }),
    );

    // If the CLI exits before reading the whole prompt, the write fails with
    // EPIPE. Unhandled, that would crash the server; the close/error handlers
    // above already report the real cause.
    child.stdin!.on("error", (e: Error) =>
      console.error(`[claude-runner] stdin write failed:`, e.message),
    );
    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}
