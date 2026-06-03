// End-to-end contract for the run-selector path (C6/PER-173).
//
// The founder can pick one / several / all interests at run time and trigger a
// run for exactly that set. POST /v0/interests accepts `selected_topics`: a
// STRICT subset of `interests`. Unlike `retry_topics` (which merges a subset
// into a PRIOR brief), a selected run produces a FRESH brief containing only the
// selected sections, with coverage computed over the SELECTED set — so a
// one-interest run honestly reports just that topic, and unselected interests
// are NOT dishonestly flagged "missing".
//
// Crucially, the FULL interest list must still be persisted to state (the
// scheduler's source of truth): a partial run must never shrink the saved set.
//
// This test drives a stub `claude` that returns each requested topic's section,
// and asserts: only the selected sessions fire, the brief contains only the
// selected section, coverage covers only the selected set, and the saved
// interest list is unchanged. Hermetic: no real claude, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import {
  loadState,
  saveState,
  newPairingToken,
  type Brief,
  type TopicCoverage,
} from "../src/state.js";
import { startServer } from "../src/server.js";

// Per-interest claude stub: each session researches ONE topic (named in the
// prompt as `single topic: "<topic>"`) and emits exactly that topic's section.
function makeTopicAwareSpawn() {
  const calls: Array<{ stdin: string }> = [];

  const sectionFor = (topic: string): string => {
    const titled = topic.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${titled}\n- ${topic} happened.\n  [example.com — ${titled}](https://example.com/${encodeURIComponent(topic)})\n`;
  };

  const spawnFn = ((_bin: string, _args: readonly string[], _options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    let stdinData = "";
    const record = { stdin: "" };
    calls.push(record);

    const finish = () => {
      record.stdin = stdinData;
      const topic = /single topic: "([^"]+)"/.exec(stdinData)?.[1] ?? "";
      const md = topic ? `# Your brief\n\n${sectionFor(topic)}` : "";
      child.stdout.emit("data", Buffer.from(md));
      child.emit("close", 0);
    };

    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        stdinData += chunk.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => setImmediate(finish));
    return child;
  }) as unknown as typeof spawn;

  return { calls, spawnFn };
}

async function seededServer() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-selected-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);
  return { tmp, stateFile, token };
}

type BriefWithTopics = Brief & { topics?: TopicCoverage[] };

test("selected_topics runs only the chosen interest and keeps the full list saved (C6/PER-173)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { calls, spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };

  let resolveNext: ((b: Brief) => void) | null = null;
  const nextDone = () =>
    new Promise<Brief>((r) => {
      resolveNext = r;
    });
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveNext?.(b),
  });

  const interests = ["startup news", "ai", "anthropic", "openai"];

  try {
    // ---- One-interest run: select only "anthropic". ----
    const done = nextDone();
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests, selected_topics: ["anthropic"] }),
    });
    assert.equal(kick.status, 202);
    await done;

    const res = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: auth,
    });
    const brief = ((await res.json()) as { briefs: BriefWithTopics[] })
      .briefs[0];
    assert.equal(brief.status, "ready");

    // Only ONE per-interest session fired, and it was for "anthropic" — we did
    // NOT re-research the whole list.
    assert.equal(calls.length, 1);
    assert.match(calls[0].stdin, /single topic: "anthropic"/);

    // The brief contains ONLY the anthropic section.
    const md = brief.summary_md ?? "";
    assert.match(md, /^##\s+Anthropic/im);
    assert.doesNotMatch(md, /^##\s+Openai/im);
    assert.doesNotMatch(md, /^##\s+Ai/im);
    assert.doesNotMatch(md, /^##\s+Startup News/im);

    // Coverage is computed over the SELECTED set only — exactly one topic,
    // "anthropic", covered. Unselected interests are NOT reported (and so are
    // never dishonestly flagged "missing").
    assert.deepEqual(brief.topics, [{ topic: "anthropic", status: "covered" }]);

    // The FULL interest list is still persisted — a partial run never shrinks the
    // scheduler's saved set.
    const state = await loadState(stateFile);
    assert.deepEqual(
      state.interests?.map((i) => i.topic),
      interests,
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("selected_topics covering the whole list collapses to a normal full run (C6/PER-173)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { calls, spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };

  let resolveNext: ((b: Brief) => void) | null = null;
  const nextDone = () =>
    new Promise<Brief>((r) => {
      resolveNext = r;
    });
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveNext?.(b),
  });

  const interests = ["ai", "anthropic"];

  try {
    const done = nextDone();
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      // Selecting every interest is not a "subset" — it's a full run, and
      // coverage should span the whole list.
      body: JSON.stringify({ interests, selected_topics: interests }),
    });
    assert.equal(kick.status, 202);
    await done;

    const res = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: auth,
    });
    const brief = ((await res.json()) as { briefs: BriefWithTopics[] })
      .briefs[0];
    assert.equal(brief.status, "ready");
    assert.equal(calls.length, 2);
    assert.deepEqual(
      brief.topics?.map((t) => t.topic),
      interests,
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
