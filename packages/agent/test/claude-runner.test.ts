// The one seam where the companion starts a `claude` child. Research reads
// untrusted web pages, so these tests pin the tool set each kind of run gets:
// a prompt-injected page must not be able to reach Bash, file tools or MCP.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { runClaude } from "../src/claude-runner.js";

type Call = { bin: string; args: readonly string[]; options: { cwd?: string } };

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
    "text",
    "--tools",
    "WebSearch,WebFetch",
    "--allowed-tools",
    "WebSearch,WebFetch",
    "--strict-mcp-config",
  ]);
});

test("a no-tools run gets an empty tool set", async () => {
  const stub = stubSpawn({ stdout: "{}" });
  await runClaude("prompt", { tools: "none", spawnFn: stub.spawnFn });

  const { args } = stub.calls[0];
  assert.deepEqual(args, [
    "--print",
    "--output-format",
    "text",
    "--tools",
    "",
    "--strict-mcp-config",
  ]);
});

test("no run bypasses Claude Code's permission checks", async () => {
  for (const tools of ["web-research", "none"] as const) {
    const stub = stubSpawn({ stdout: "x" });
    await runClaude("prompt", { tools, spawnFn: stub.spawnFn });
    const argv = stub.calls[0].args.join(" ");
    assert.doesNotMatch(argv, /dangerously|bypassPermissions/);
  }
});

test("the child runs in the temp dir, never the companion's working directory", async () => {
  const stub = stubSpawn({ stdout: "x" });
  await runClaude("prompt", { tools: "none", spawnFn: stub.spawnFn });
  assert.equal(stub.calls[0].options.cwd, os.tmpdir());
});

test("the prompt goes over stdin and stdout comes back as-is", async () => {
  const stub = stubSpawn({ stdout: "  raw output \n" });
  const out = await runClaude("the prompt", {
    tools: "none",
    spawnFn: stub.spawnFn,
  });
  assert.equal(stub.prompts[0], "the prompt");
  assert.equal(out, "  raw output \n");
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
