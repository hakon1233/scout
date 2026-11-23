// A research session returns its output (the prompt itself is tested in
// packages/core).

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { researchAndSynthesize } from "../src/research.js";

test("a session that closes in time is NOT affected by the timeout", async () => {
  // A fast, well-behaved stub still resolves normally — the timeout is a ceiling,
  // not a delay.
  const spawnFn = ((_bin: string, _args: readonly string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    child.stdin.on("finish", () =>
      setImmediate(() => {
        child.stdout.emit(
          "data",
          Buffer.from("## ai\n- a thing.\n  [src](https://example.com/a)\n"),
        );
        child.emit("close", 0);
      }),
    );
    return child;
  }) as unknown as typeof spawn;

  const { text, usage } = await researchAndSynthesize(
    { topic: "ai", doc: "track ai" },
    { spawnFn, timeoutMs: 5000 },
  );
  assert.match(text, /## ai/);
  assert.equal(usage, null, "plain text output carries no usage");
});
