// An ephemeral POST /v0/interests produces a brief without changing the saved
// interests, their docs or the brief history.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { loadState, saveState, newPairingToken } from "../src/state.js";
import type { Brief } from "../src/contract.js";
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

// Seed a state file + an interests dir holding the user's AUTHORED docs, with
// state.interests anchored to those ids — the exact shape an ephemeral run must
// protect.
async function seededReader() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-ephemeral-test-"));
  const stateFile = path.join(tmp, "state.json");
  const interestsDir = path.join(tmp, "interests");
  await fs.mkdir(interestsDir, { recursive: true });
  const token = newPairingToken();
  const reader = [
    { id: "int_authored_aaa", topic: "harness news" },
    { id: "int_authored_bbb", topic: "ai coding tools & models" },
  ];
  // Rich authored bodies — distinct from the default template so an overwrite
  // would be detectable byte-for-byte.
  const docs: Record<string, string> = {
    int_authored_aaa:
      "# harness news\n\nAUTHORED: gstack, Matt Pocock skills repo.\n",
    int_authored_bbb:
      "# ai coding tools & models\n\nAUTHORED: combine codex/claude code/anthropic.\n",
  };
  for (const it of reader) {
    await fs.writeFile(path.join(interestsDir, `${it.id}.md`), docs[it.id]);
  }
  await saveState({ pairing_token: token, interests: reader }, stateFile);
  return { tmp, stateFile, interestsDir, token, reader, docs };
}

test("ephemeral run produces a brief but never mutates the user's saved interests or docs", async () => {
  const { tmp, stateFile, interestsDir, token, reader, docs } =
    await seededReader();
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
    assert.equal(
      (brief as Brief & { ephemeral?: boolean }).ephemeral,
      true,
      "the pollable QA result must be marked so the real feed can ignore it",
    );

    // INVARIANT 1: saved interests are byte-identical to the seeded set — the
    // test payload did NOT replace or shrink them.
    const state = await loadState(stateFile);
    assert.equal(
      (state.last_brief as (Brief & { ephemeral?: boolean }) | undefined)
        ?.ephemeral,
      true,
      "the persisted last_brief slot must retain its ephemeral provenance",
    );
    assert.deepEqual(
      state.interests?.map((i) => ({ id: i.id, topic: i.topic })),
      reader,
    );

    // INVARIANT 2: the real interests dir is unchanged — no new templated docs were
    // created and the authored bodies were not overwritten.
    const after = await fs.readdir(interestsDir);
    assert.deepEqual(after.sort(), before.sort());
    for (const it of reader) {
      const body = await fs.readFile(
        path.join(interestsDir, `${it.id}.md`),
        "utf8",
      );
      assert.equal(body, docs[it.id]);
    }

    // INVARIANT 3: an ephemeral run must NOT pollute the rolling brief
    // history. `state.briefs` is the channel the feed's "previous briefs" pager
    // reads — a QA/dry-run brief landing there would surface to the user as a
    // real past edition. The runner gates the append on `!isEphemeral`, so the
    // history stays empty here even though a brief was produced above.
    assert.equal(state.briefs, undefined);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
