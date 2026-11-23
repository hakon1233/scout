// The one seam where the companion starts a `claude` child. Research reads
// untrusted web pages, so these tests pin the tool set each kind of run gets:
// a prompt-injected page must not be able to reach Bash, file tools or MCP.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { parseCliOutput, runClaude } from "../src/claude-runner.js";

type Call = {
  bin: string;
  args: readonly string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv };
};

// A spawn stand-in: records the call, then answers with `stdout`/`stderr` and
// `exitCode` once the prompt is written, or never closes when `hang` is set.
function stubSpawn(
  reply: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    hang?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const kills: string[] = [];
  const prompts: string[] = [];
  const spawnFn = ((
    bin: string,
    args: readonly string[],
    options: Call["options"],
  ) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
      kill: (sig?: string) => boolean;
    };
    child.pid = undefined; // skip os.setPriority in the stub
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig?: string) => {
      kills.push(sig ?? "");
      return true;
    };
    let written = "";
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        written += chunk.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => {
      prompts.push(written);
      if (reply.hang) return;
      setImmediate(() => {
        if (reply.stdout) child.stdout.emit("data", Buffer.from(reply.stdout));
        if (reply.stderr) child.stderr.emit("data", Buffer.from(reply.stderr));
        child.emit("close", reply.exitCode ?? 0);
      });
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnFn, calls, kills, prompts };
}

test("a web-research run can use WebSearch and WebFetch and nothing else", async () => {
  const stub = stubSpawn({ stdout: "## ai\n" });
  await runClaude("prompt", { tools: "web-research", spawnFn: stub.spawnFn });

  const { args } = stub.calls[0];
  assert.deepEqual(args, [
    "--print",
    "--output-format",
    "json",
    "--tools",
    "WebSearch,WebFetch",
    "--allowed-tools",
    "WebSearch,WebFetch",
    "--max-turns",
    "25",
    "--strict-mcp-config",
    "--safe-mode",
    "--setting-sources",
    "",
  ]);
});

test("a capped run passes its turn limit to the CLI", async () => {
  const stub = stubSpawn({ stdout: "## ai\n" });
  await runClaude("prompt", {
    tools: "web-research",
    spawnFn: stub.spawnFn,
    maxTurns: 12,
  });

  const { args } = stub.calls[0];
  const at = args.indexOf("--max-turns");
  assert.deepEqual(args.slice(at, at + 2), ["--max-turns", "12"]);
  assert.equal(args.lastIndexOf("--max-turns"), at, "one turn limit only");
});

test("a no-tools run gets an empty tool set", async () => {
  const stub = stubSpawn({ stdout: "{}" });
  await runClaude("prompt", { tools: "none", spawnFn: stub.spawnFn });

  const { args } = stub.calls[0];
  assert.deepEqual(args, [
    "--print",
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--safe-mode",
    "--setting-sources",
    "",
  ]);
});

test("the child gets only the environment it needs to run and sign in", async () => {
  const names = [
    "PATH",
    "HOME",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "SCOUT_E2E_PORT",
    "GITHUB_TOKEN",
    "OPENAI_API_KEY",
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names.slice(2)) process.env[n] = `test-${n}`;
  try {
    const stub = stubSpawn({ stdout: "x" });
    await runClaude("prompt", { tools: "none", spawnFn: stub.spawnFn });
    const env: Record<string, string | undefined> =
      stub.calls[0].options.env ?? {};
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.HOME, process.env.HOME);
    assert.equal(env.ANTHROPIC_API_KEY, "test-ANTHROPIC_API_KEY");
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "test-CLAUDE_CODE_OAUTH_TOKEN");
    assert.equal(env.SCOUT_E2E_PORT, "test-SCOUT_E2E_PORT");
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
  } finally {
    for (const [n, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
});

test("the child runs in the temp dir, never the companion's working directory", async () => {
  const stub = stubSpawn({ stdout: "x" });
  await runClaude("prompt", { tools: "none", spawnFn: stub.spawnFn });
  assert.equal(stub.calls[0].options.cwd, os.tmpdir());
});

// What `claude --print --output-format json` prints: one result object.
const CLI_RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 7,
  result: "## ai\n- a story",
  stop_reason: "end_turn",
  total_cost_usd: 0.0812,
  usage: {
    input_tokens: 120,
    output_tokens: 900,
    cache_read_input_tokens: 30_000,
    cache_creation_input_tokens: 4_000,
    server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
  },
  modelUsage: {
    "claude-sonnet-5-5": {
      inputTokens: 120,
      outputTokens: 900,
      cacheReadInputTokens: 30_000,
      cacheCreationInputTokens: 4_000,
      webSearchRequests: 3,
      costUSD: 0.08,
    },
    "claude-haiku-5-5": {
      inputTokens: 2_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0.0012,
    },
  },
  session_id: "s",
};

test("the prompt goes over stdin and the json result's text and usage come back", async () => {
  const stub = stubSpawn({ stdout: JSON.stringify(CLI_RESULT) + "\n" });
  const out = await runClaude("the prompt", {
    tools: "none",
    spawnFn: stub.spawnFn,
  });
  assert.equal(stub.prompts[0], "the prompt");
  assert.equal(out.text, "## ai\n- a story");
  assert.deepEqual(out.usage, {
    model: "claude-sonnet-5-5",
    stopReason: "end_turn",
    turns: 7,
    // Every model the session used, summed (the CLI's side calls included).
    inputTokens: 2_120,
    outputTokens: 1_000,
    cacheReadTokens: 30_000,
    cacheWriteTokens: 4_000,
    webSearches: 3,
    webFetches: 0,
    costUsd: 0.0812,
  });
});

test("output that is not the json result comes back as-is with no usage", async () => {
  for (const stdout of [
    "  raw output \n",
    '{"result": "trunc',
    "[1,2]",
    "{}",
  ]) {
    const stub = stubSpawn({ stdout });
    const out = await runClaude("p", { tools: "none", spawnFn: stub.spawnFn });
    assert.equal(out.text, stdout);
    assert.equal(out.usage, null);
  }
});

test("a result without model usage falls back to its usage totals", () => {
  const bare: Record<string, unknown> = { ...CLI_RESULT };
  delete bare.modelUsage;
  const out = parseCliOutput(JSON.stringify(bare));
  assert.deepEqual(out.usage, {
    model: null,
    stopReason: "end_turn",
    turns: 7,
    inputTokens: 120,
    outputTokens: 900,
    cacheReadTokens: 30_000,
    cacheWriteTokens: 4_000,
    webSearches: 3,
    webFetches: 0,
    costUsd: 0.0812,
  });
});

test("garbled numbers in the json result count as zero, never NaN", () => {
  const out = parseCliOutput(
    JSON.stringify({
      type: "result",
      result: "x",
      num_turns: "seven",
      total_cost_usd: null,
      usage: { input_tokens: -5, output_tokens: "9" },
    }),
  );
  assert.equal(out.text, "x");
  assert.deepEqual(out.usage, {
    model: null,
    stopReason: null,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    webFetches: null,
    costUsd: 0,
  });
});

test("a failed json result rejects with the CLI's own words, not the json", async () => {
  const limit = stubSpawn({
    stdout: JSON.stringify({
      ...CLI_RESULT,
      is_error: true,
      result: "Claude AI usage limit reached|1764000000",
    }),
    exitCode: 1,
  });
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn: limit.spawnFn }),
    { message: "claude exited 1: Claude AI usage limit reached|1764000000" },
  );

  const maxTurns = stubSpawn({
    stdout: JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      num_turns: 26,
      errors: [],
      usage: { input_tokens: 429, output_tokens: 1 },
    }),
    exitCode: 1,
  });
  await assert.rejects(
    runClaude("p", { tools: "web-research", spawnFn: maxTurns.spawnFn }),
    { message: "claude exited 1: error_max_turns" },
  );

  // is_error on exit 0 is still a failed session.
  const flagged = stubSpawn({
    stdout: JSON.stringify({
      ...CLI_RESULT,
      is_error: true,
      result: "API Error: 500",
    }),
  });
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn: flagged.spawnFn }),
    { message: "claude exited 0: API Error: 500" },
  );
});

test("the binary comes from claudeBin, then SCOUT_CLAUDE_BIN, then `claude`", async () => {
  const previous = process.env.SCOUT_CLAUDE_BIN;
  try {
    delete process.env.SCOUT_CLAUDE_BIN;
    const a = stubSpawn({ stdout: "x" });
    await runClaude("p", { tools: "none", spawnFn: a.spawnFn });
    assert.equal(a.calls[0].bin, "claude");

    process.env.SCOUT_CLAUDE_BIN = "/opt/fake-claude";
    const b = stubSpawn({ stdout: "x" });
    await runClaude("p", { tools: "none", spawnFn: b.spawnFn });
    assert.equal(b.calls[0].bin, "/opt/fake-claude");

    const c = stubSpawn({ stdout: "x" });
    await runClaude("p", {
      tools: "none",
      spawnFn: c.spawnFn,
      claudeBin: "/explicit",
    });
    assert.equal(c.calls[0].bin, "/explicit");
  } finally {
    if (previous === undefined) delete process.env.SCOUT_CLAUDE_BIN;
    else process.env.SCOUT_CLAUDE_BIN = previous;
  }
});

test("SCOUT_CLAUDE_MODEL picks the model; unset, the CLI's default is used", async () => {
  const previous = process.env.SCOUT_CLAUDE_MODEL;
  try {
    delete process.env.SCOUT_CLAUDE_MODEL;
    const a = stubSpawn({ stdout: "x" });
    await runClaude("p", { tools: "none", spawnFn: a.spawnFn });
    assert.ok(!a.calls[0].args.includes("--model"));

    process.env.SCOUT_CLAUDE_MODEL = "sonnet";
    const b = stubSpawn({ stdout: "x" });
    await runClaude("p", { tools: "none", spawnFn: b.spawnFn });
    assert.deepEqual(b.calls[0].args.slice(-2), ["--model", "sonnet"]);
  } finally {
    if (previous === undefined) delete process.env.SCOUT_CLAUDE_MODEL;
    else process.env.SCOUT_CLAUDE_MODEL = previous;
  }
});

test("a CLI too old for Scout's flags is told to update Claude Code", async () => {
  const stub = stubSpawn({
    stderr: "error: unknown option '--safe-mode'",
    exitCode: 1,
  });
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn: stub.spawnFn }),
    (err: Error) =>
      /update Claude Code/.test(err.message) &&
      err.message.includes("unknown option '--safe-mode'"),
  );
});

test("a non-zero exit names stderr, or stdout when stderr is empty", async () => {
  const withStderr = stubSpawn({
    stderr: "boom",
    stdout: "ignored",
    exitCode: 2,
  });
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn: withStderr.spawnFn }),
    { message: "claude exited 2: boom" },
  );

  // The CLI prints a usage-cap notice on stdout and exits 1 with stderr empty.
  const stdoutOnly = stubSpawn({
    stdout: "You've hit your session limit",
    exitCode: 1,
  });
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn: stdoutOnly.spawnFn }),
    { message: "claude exited 1: You've hit your session limit" },
  );
});

test("a hung child is killed with SIGTERM and the run rejects with the label", async () => {
  const stub = stubSpawn({ hang: true });
  await assert.rejects(
    runClaude("p", {
      tools: "none",
      spawnFn: stub.spawnFn,
      timeoutMs: 30,
      label: 'claude session for "ai"',
    }),
    { message: 'claude session for "ai" timed out after 30ms' },
  );
  assert.equal(stub.kills[0], "SIGTERM");
});

test("aborting kills the child and rejects", async () => {
  const stub = stubSpawn({ hang: true });
  const controller = new AbortController();
  const run = runClaude("p", {
    tools: "none",
    spawnFn: stub.spawnFn,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(stub.kills[0], "SIGTERM");
});

test("an already-aborted signal never spawns a child", async () => {
  const stub = stubSpawn({ stdout: "x" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runClaude("p", {
      tools: "none",
      spawnFn: stub.spawnFn,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(stub.calls.length, 0);
});

test("a spawn failure says the CLI may be missing", async () => {
  const spawnFn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    setImmediate(() => child.emit("error", new Error("ENOENT")));
    return child;
  }) as unknown as typeof spawn;
  await assert.rejects(
    runClaude("p", { tools: "none", spawnFn, claudeBin: "claude" }),
    {
      message:
        "failed to spawn 'claude' — is the Claude Code CLI installed and on PATH? (ENOENT)",
    },
  );
});
