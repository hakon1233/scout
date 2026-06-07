// Contract for the ephemeral / dry-run trigger (PER-218).
//
// Background — the incident this guards against: a normal POST /v0/interests
// persists its `interests` body as the founder's new saved list (reconcileInterests
// → startRun → saveState) and lazily backfills a default intent doc for every new
// id. A QA/automation run that POSTed a reduced or generic test payload therefore
// OVERWROTE the founder's authored interests and littered the doc store with
// templated docs.
//
// The fix: `ephemeral: true`. An ephemeral run researches the supplied topics and
// produces a brief, but MUST NOT mutate the founder's saved config — `state.interests`
// is left verbatim and the intent-doc backfill is redirected to a throwaway temp dir,
// so no real `interests/<id>.md` is created or overwritten. This test pins exactly
// that: founder's saved interests + on-disk docs are byte-identical after an ephemeral
// run, while a brief still lands. Hermetic: no real claude, no network.

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
} from "../src/state.js";
import { startServer } from "../src/server.js";

// A claude stub: each per-interest session emits that one topic's section.
function makeTopicAwareSpawn() {
  const calls: Array<{ stdin: string }> = [];
  const sectionFor = (topic: string): string => {
    const titled = topic.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${titled}\n- ${topic} happened.\n  [example.com — ${titled}](https://example.com/${encodeURIComponent(topic)})\n`;
  };
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

// Seed a state file + an interests dir holding the founder's AUTHORED docs, with
// state.interests anchored to those ids — the exact shape PER-218 must protect.
async function seededFounder() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-ephemeral-test-"));
  const stateFile = path.join(tmp, "state.json");
  const interestsDir = path.join(tmp, "interests");
  await fs.mkdir(interestsDir, { recursive: true });
  const token = newPairingToken();
  const founder = [
    { id: "int_authored_aaa", topic: "harness news" },
    { id: "int_authored_bbb", topic: "ai coding tools & models" },
  ];
  // Rich authored bodies — distinct from the default template so an overwrite
  // would be detectable byte-for-byte.
  const docs: Record<string, string> = {
    int_authored_aaa: "# harness news\n\nAUTHORED: gstack, Matt Pocock skills repo.\n",
    int_authored_bbb: "# ai coding tools & models\n\nAUTHORED: combine codex/claude code/anthropic.\n",
  };
  for (const it of founder) {
    await fs.writeFile(path.join(interestsDir, `${it.id}.md`), docs[it.id]);
  }
  await saveState({ pairing_token: token, interests: founder }, stateFile);
  return { tmp, stateFile, interestsDir, token, founder, docs };
}

test("ephemeral run produces a brief but never mutates the founder's saved interests or docs (PER-218)", async () => {
  const { tmp, stateFile, interestsDir, token, founder, docs } =
    await seededFounder();
  const { calls, spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };

  let resolveNext: ((b: Brief) => void) | null = null;
  const nextDone = () => new Promise<Brief>((r) => (resolveNext = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveNext?.(b),
  });

  try {
    const before = await fs.readdir(interestsDir);

    // QA fires a test run with a REDUCED / FOREIGN payload — exactly the shape that
    // clobbered the real store — but flagged ephemeral.
    const done = nextDone();
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        interests: ["technology", "startup funding"],
        ephemeral: true,
      }),
    });
    assert.equal(kick.status, 202);
    const brief = await done;

    // A brief still landed (the pipeline ran end-to-end).
    assert.equal(brief.status, "ready");
    assert.equal(calls.length, 2); // researched the two ephemeral topics

    // INVARIANT 1: saved interests are byte-identical to the founder's set — the
    // test payload did NOT replace or shrink them.
    const state = await loadState(stateFile);
    assert.deepEqual(
      state.interests?.map((i) => ({ id: i.id, topic: i.topic })),
      founder,
    );

    // INVARIANT 2: the real interests dir is unchanged — no new templated docs were
    // created and the authored bodies were not overwritten.
    const after = await fs.readdir(interestsDir);
    assert.deepEqual(after.sort(), before.sort());
    for (const it of founder) {
      const body = await fs.readFile(
        path.join(interestsDir, `${it.id}.md`),
        "utf8",
      );
      assert.equal(body, docs[it.id]);
    }
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a NON-ephemeral POST still persists its interests (normal path unbroken)", async () => {
  const { tmp, stateFile, token } = await seededFounder();
  const { spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };

  let resolveNext: ((b: Brief) => void) | null = null;
  const nextDone = () => new Promise<Brief>((r) => (resolveNext = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveNext?.(b),
  });

  try {
    const done = nextDone();
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["ai", "robotics"] }),
    });
    assert.equal(kick.status, 202);
    await done;

    // The real UI's "Run now" sends the full current list; a normal POST is meant
    // to persist it. This stays true — only `ephemeral: true` opts out.
    const state = await loadState(stateFile);
    assert.deepEqual(
      state.interests?.map((i) => i.topic),
      ["ai", "robotics"],
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
