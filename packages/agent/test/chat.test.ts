// Chat-session contract tests (PER-172 / C4): POST /v0/chat → poll GET /v0/chat.
//
// The chat manages the WHOLE interest collection: one turn can create, refine,
// or delete an interest. We mock the `claude` shell-out with an in-process spawn
// stub that returns a canned `{reply, changes}` JSON object, so these are fully
// hermetic — zero quota, no network. The key acceptance is end-to-end: a doc
// edit made via chat PERSISTS to interests/<id>.md (so C2's next run sees it) and
// is observable in the same turn's machine-readable change set.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import {
  saveState,
  loadState,
  newPairingToken,
  type ChatTurn,
  type State,
} from "../src/state.js";
import { readInterestDoc, writeInterestDoc } from "../src/docs.js";
import { startServer } from "../src/server.js";

// A spawn() stand-in that returns a fixed text payload (the model's JSON) and
// records argv / spawn options / the prompt piped to stdin — so we can assert the
// pairing token never leaks to the chat child (the PER-108 contract on this new
// route too). With autoClose:false the child hangs until releaseAll(), to hold a
// turn "in flight" for the single-flight (409) test.
function makeChatSpawn(opts: { output: string; autoClose: boolean }) {
  const calls: Array<{
    bin: string;
    args: readonly string[];
    options: unknown;
    stdin: string;
  }> = [];
  const pending: Array<() => void> = [];

  const spawnFn = ((bin: string, args: readonly string[], options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined; // skip the os.setPriority() hedge in tests
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    let stdinData = "";
    const record = { bin, args, options, stdin: "" };
    calls.push(record);

    const finish = () => {
      record.stdin = stdinData;
      child.stdout.emit("data", Buffer.from(opts.output));
      child.emit("close", 0);
    };

    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        stdinData += chunk.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => {
      if (opts.autoClose) setImmediate(finish);
      else pending.push(finish);
    });

    return child;
  }) as unknown as typeof spawn;

  return {
    calls,
    spawnFn,
    releaseAll() {
      while (pending.length) pending.shift()!();
    },
  };
}

async function seeded(state: Partial<State> = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-chat-"));
  const stateFile = path.join(tmp, "state.json");
  const interestsDir = path.join(tmp, "interests");
  const token = newPairingToken();
  await saveState({ pairing_token: token, ...state } as State, stateFile);
  return { tmp, stateFile, interestsDir, token };
}

// Kick a turn and wait for the onChatDone callback to fire, then return the turn.
function awaitTurn(): { onChatDone: (t: ChatTurn) => void; done: Promise<ChatTurn> } {
  let resolve!: (t: ChatTurn) => void;
  const done = new Promise<ChatTurn>((r) => (resolve = r));
  return { onChatDone: (t) => resolve(t), done };
}

test("POST /v0/chat refines an existing interest's doc; the edit persists and is in the change set (PER-172)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);

  const model = JSON.stringify({
    reply: "Tightened your AI-safety focus to alignment evals.",
    changes: [
      { op: "update", interestId: "int_abc123", doc: "Focus on alignment eval results." },
    ],
  });
  const { spawnFn } = makeChatSpawn({ output: model, autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const since = new Date(Date.now() - 1000).toISOString();

    // Unauth → 401.
    const unauth = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(unauth.status, 401);

    // Kick → 202 with a turn id + pending.
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Make my AI safety topic about alignment evals." }),
    });
    assert.equal(kick.status, 202);
    const kickBody = (await kick.json()) as { turn_id: string; status: string };
    assert.ok(kickBody.turn_id);
    assert.equal(kickBody.status, "pending");

    const turn = await done;
    assert.equal(turn.status, "ready");

    // Poll → the ready turn carries the reply + the machine-readable change set.
    const poll = await fetch(
      `http://127.0.0.1:${port}/v0/chat?since=${encodeURIComponent(since)}`,
      { headers: auth },
    );
    assert.equal(poll.status, 200);
    const body = (await poll.json()) as { turns: ChatTurn[] };
    assert.equal(body.turns.length, 1);
    const t = body.turns[0];
    assert.equal(t.status, "ready");
    assert.match(t.reply ?? "", /alignment/);
    assert.deepEqual(t.changes, [
      {
        interestId: "int_abc123",
        op: "update",
        topic: "ai safety",
        doc: "Focus on alignment eval results.",
      },
    ]);

    // ACCEPTANCE: the edit is durable on disk — C2's next run for this interest
    // will read the new doc.
    assert.equal(await readInterestDoc("int_abc123", interestsDir), "Focus on alignment eval results.");

    // A future `since` filters the turn out (mirrors GET /v0/briefs).
    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await fetch(
      `http://127.0.0.1:${port}/v0/chat?since=${encodeURIComponent(future)}`,
      { headers: auth },
    );
    assert.deepEqual(((await empty.json()) as { turns: ChatTurn[] }).turns, []);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat creates a new interest (+ its doc) with a server-minted id (PER-172)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });

  const model = JSON.stringify({
    reply: "Added Formula 1 to your interests.",
    // The model must NOT invent an id for a create — the server mints it.
    changes: [{ op: "create", topic: "formula 1", doc: "Race results and team news." }],
  });
  const { spawnFn } = makeChatSpawn({ output: model, autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Also track Formula 1." }),
    });
    assert.equal(kick.status, 202);
    const turn = await done;
    assert.equal(turn.status, "ready");

    // The applied change carries a concrete, server-assigned id (not echoed back
    // from the model, which never supplied one).
    assert.equal(turn.changes?.length, 1);
    const change = turn.changes![0];
    assert.equal(change.op, "create");
    assert.equal(change.topic, "formula 1");
    assert.match(change.interestId, /^int_[0-9a-f]+$/);

    // It landed in state.interests (so the scheduler/engine will research it)…
    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.topic),
      ["ai safety", "formula 1"],
    );
    // …and its doc is on disk under the minted id.
    assert.equal(await readInterestDoc(change.interestId, interestsDir), "Race results and team news.");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat deletes an interest and removes its doc (PER-172)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [
      { id: "int_keep01", topic: "ai safety" },
      { id: "int_drop02", topic: "crypto" },
    ],
  });
  await writeInterestDoc("int_drop02", "crypto doc", interestsDir);

  const model = JSON.stringify({
    reply: "Removed crypto.",
    changes: [{ op: "delete", interestId: "int_drop02" }],
  });
  const { spawnFn } = makeChatSpawn({ output: model, autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Drop crypto." }),
    });
    assert.equal(kick.status, 202);
    const turn = await done;
    assert.equal(turn.status, "ready");
    assert.deepEqual(turn.changes, [
      { interestId: "int_drop02", op: "delete", topic: "crypto" },
    ]);

    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.id),
      ["int_keep01"],
    );
    assert.equal(await readInterestDoc("int_drop02", interestsDir), null);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat ignores a change targeting an id the companion doesn't hold (no arbitrary writes)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });

  // The model names an id that isn't in the interest set — a path-safe but
  // foreign id. It must be dropped: never write an arbitrary <id>.md.
  const model = JSON.stringify({
    reply: "Done.",
    changes: [{ op: "update", interestId: "int_evil99", doc: "should not be written" }],
  });
  const { spawnFn } = makeChatSpawn({ output: model, autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "edit something" }),
    });
    assert.equal(kick.status, 202);
    const turn = await done;
    assert.equal(turn.status, "ready");
    assert.deepEqual(turn.changes, []); // dropped → empty applied set
    assert.equal(await readInterestDoc("int_evil99", interestsDir), null);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat returns 409 while a turn is in flight; the prior turn isn't clobbered", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  const model = JSON.stringify({ reply: "ok", changes: [] });
  const { spawnFn, releaseAll } = makeChatSpawn({ output: model, autoClose: false });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick1 = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "first" }),
    });
    assert.equal(kick1.status, 202);
    const firstId = ((await kick1.json()) as { turn_id: string }).turn_id;

    // Second kick lands while the first hangs → 409 echoing the in-flight id.
    const kick2 = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "second" }),
    });
    assert.equal(kick2.status, 409);
    const body2 = (await kick2.json()) as { error: string; turn_id: string };
    assert.equal(body2.turn_id, firstId);
    assert.match(body2.error, /in progress/);

    // Release the first; it lands under its own id.
    releaseAll();
    const landed = await done;
    assert.equal(landed.id, firstId);
    assert.equal(landed.status, "ready");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat rejects an empty message with 400 and never spawns claude", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded();
  const recorder = makeChatSpawn({ output: "{}", autoClose: true });
  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: recorder.spawnFn,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /message required/);
    assert.equal(recorder.calls.length, 0, "no claude child for a rejected message");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("the pairing token never reaches the chat claude child (argv/options/stdin) (PER-108)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  const model = JSON.stringify({ reply: "ok", changes: [] });
  const recorder = makeChatSpawn({ output: model, autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: recorder.spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "track quantum computing" }),
    });
    assert.equal(kick.status, 202);
    await done;

    assert.equal(recorder.calls.length, 1);
    const call = recorder.calls[0];
    assert.ok(!JSON.stringify(call.args).includes(token), "token leaked into chat argv");
    assert.ok(
      !JSON.stringify(call.options ?? {}).includes(token),
      "token leaked into chat spawn options/env",
    );
    assert.ok(!call.stdin.includes(token), "token leaked into the chat prompt (stdin)");
    // The prompt carries the user's message + interest context, proving we
    // inspected a real prompt.
    assert.match(call.stdin, /quantum computing/);
    assert.match(call.stdin, /ai safety/);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
