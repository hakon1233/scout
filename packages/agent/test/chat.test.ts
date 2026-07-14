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
import {
  buildChatPrompt,
  isChatInFlight,
  readChatTranscript,
  startChatTurn,
} from "../src/chat.js";
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
function awaitTurn(): {
  onChatDone: (t: ChatTurn) => void;
  done: Promise<ChatTurn>;
} {
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
      {
        op: "update",
        interestId: "int_abc123",
        doc: "Focus on alignment eval results.",
      },
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
      body: JSON.stringify({
        message: "Make my AI safety topic about alignment evals.",
      }),
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
    assert.equal(
      await readInterestDoc("int_abc123", interestsDir),
      "Focus on alignment eval results.",
    );

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
    changes: [
      { op: "create", topic: "formula 1", doc: "Race results and team news." },
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
    assert.equal(
      await readInterestDoc(change.interestId, interestsDir),
      "Race results and team news.",
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /v0/chat returns the full persisted transcript after companion restart (PER-201)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  const firstModel = JSON.stringify({
    reply: "Added your AI safety preference.",
    changes: [],
  });
  const secondModel = JSON.stringify({
    reply: "You asked me to track AI safety.",
    changes: [],
  });
  const first = makeChatSpawn({ output: firstModel, autoClose: true });
  const firstDone = awaitTurn();

  const firstServer = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: first.spawnFn,
    onChatDone: firstDone.onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick1 = await fetch(`http://127.0.0.1:${firstServer.port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Track AI safety." }),
    });
    assert.equal(kick1.status, 202);
    await firstDone.done;
  } finally {
    firstServer.server.close();
  }

  const second = makeChatSpawn({ output: secondModel, autoClose: true });
  const secondDone = awaitTurn();
  const restarted = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: second.spawnFn,
    onChatDone: secondDone.onChatDone,
  });

  try {
    const kick2 = await fetch(`http://127.0.0.1:${restarted.port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "What did I ask you to track?" }),
    });
    assert.equal(kick2.status, 202);
    await secondDone.done;

    const transcript = await fetch(
      `http://127.0.0.1:${restarted.port}/v0/chat`,
      {
        headers: auth,
      },
    );
    assert.equal(transcript.status, 200);
    const body = (await transcript.json()) as { turns: ChatTurn[] };
    assert.deepEqual(
      body.turns.map((t) => [t.message, t.reply]),
      [
        ["Track AI safety.", "Added your AI safety preference."],
        ["What did I ask you to track?", "You asked me to track AI safety."],
      ],
    );
    assert.ok(
      !JSON.stringify(body.turns).includes(token),
      "token leaked into chat transcript",
    );
  } finally {
    restarted.server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a new chat turn receives earlier transcript turns as model context (PER-201)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  const first = makeChatSpawn({
    output: JSON.stringify({ reply: "I'll remember AI safety.", changes: [] }),
    autoClose: true,
  });
  const firstDone = awaitTurn();
  const { server: firstServer, port: firstPort } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: first.spawnFn,
    onChatDone: firstDone.onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick1 = await fetch(`http://127.0.0.1:${firstPort}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Remember that AI safety means evals." }),
    });
    assert.equal(kick1.status, 202);
    await firstDone.done;
  } finally {
    firstServer.close();
  }

  const second = makeChatSpawn({
    output: JSON.stringify({ reply: "You meant evals.", changes: [] }),
    autoClose: true,
  });
  const secondDone = awaitTurn();
  const { server: secondServer, port: secondPort } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn: second.spawnFn,
    onChatDone: secondDone.onChatDone,
  });

  try {
    const kick2 = await fetch(`http://127.0.0.1:${secondPort}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Make that broader." }),
    });
    assert.equal(kick2.status, 202);
    await secondDone.done;

    assert.equal(second.calls.length, 1);
    assert.match(
      second.calls[0].stdin,
      /Remember that AI safety means evals\./,
    );
    assert.match(second.calls[0].stdin, /I'll remember AI safety\./);
    assert.ok(
      !second.calls[0].stdin.includes(token),
      "token leaked into replayed prompt",
    );
  } finally {
    secondServer.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat GATES a delete: surfaces pending_delete and leaves the interest intact (PER-230)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [
      { id: "int_keep01", topic: "ai safety" },
      { id: "int_drop02", topic: "crypto" },
    ],
  });
  await writeInterestDoc("int_drop02", "crypto doc", interestsDir);

  const model = JSON.stringify({
    reply: "Want me to remove crypto?",
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
    // The delete is NOT applied — it is surfaced as a pending confirmation.
    assert.deepEqual(turn.changes ?? [], []);
    assert.deepEqual(turn.pending_delete, {
      interestId: "int_drop02",
      topic: "crypto",
    });

    // The interest and its doc are untouched until the user confirms.
    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.id),
      ["int_keep01", "int_drop02"],
    );
    assert.equal(
      await readInterestDoc("int_drop02", interestsDir),
      "crypto doc",
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat/confirm-delete removes the interest + doc and returns a ready turn (PER-230)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [
      { id: "int_keep01", topic: "ai safety" },
      { id: "int_drop02", topic: "crypto" },
    ],
    last_chat: {
      id: "chat_delete_proposal1",
      created_at: new Date().toISOString(),
      status: "ready",
      message: "Drop crypto.",
      reply: "Want me to remove crypto?",
      changes: [],
      pending_delete: {
        interestId: "int_drop02",
        topic: "crypto",
      },
    },
  });
  await writeInterestDoc("int_drop02", "crypto doc", interestsDir);

  // confirm-delete is deterministic — no model round-trip. Spawn must never run.
  const { spawnFn, calls } = makeChatSpawn({ output: "{}", autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/chat/confirm-delete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interestId: "int_drop02" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { turn?: ChatTurn };
    assert.ok(body.turn, "confirm-delete returned a turn");
    assert.equal(body.turn!.status, "ready");
    assert.deepEqual(body.turn!.changes, [
      { interestId: "int_drop02", op: "delete", topic: "crypto" },
    ]);

    const turn = await done; // onChatDone fired with the same ready turn
    assert.equal(turn.status, "ready");

    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.id),
      ["int_keep01"],
    );
    assert.equal(await readInterestDoc("int_drop02", interestsDir), null);
    assert.equal(calls.length, 0, "confirm-delete must not spawn the model");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat/confirm-delete returns 404 for an unknown id (nothing removed)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_keep01", topic: "ai safety" }],
    last_chat: {
      id: "chat_delete_proposal1",
      created_at: new Date().toISOString(),
      status: "ready",
      message: "Drop ai safety.",
      reply: "Want me to remove ai safety?",
      changes: [],
      pending_delete: {
        interestId: "int_keep01",
        topic: "ai safety",
      },
    },
  });
  const { spawnFn } = makeChatSpawn({ output: "{}", autoClose: true });

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/chat/confirm-delete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interestId: "int_nope99" }),
    });
    assert.equal(res.status, 404);

    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.id),
      ["int_keep01"],
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat/confirm-delete returns 404 without a matching pending delete", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_keep01", topic: "ai safety" }],
  });
  await writeInterestDoc("int_keep01", "keep doc", interestsDir);
  const { spawnFn } = makeChatSpawn({ output: "{}", autoClose: true });

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/chat/confirm-delete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interestId: "int_keep01" }),
    });
    assert.equal(res.status, 404);

    const state = await loadState(stateFile);
    assert.deepEqual(state.interests, [{ id: "int_keep01", topic: "ai safety" }]);
    assert.equal(await readInterestDoc("int_keep01", interestsDir), "keep doc");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat GATES a full rewrite: surfaces pending_rewrite and leaves the doc byte-identical (PER-235)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);

  const model = JSON.stringify({
    reply: "Here's a full rewrite — review and Apply below.",
    changes: [
      { op: "rewrite", interestId: "int_abc123", doc: "brand new doc" },
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
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "Completely rewrite ai safety from scratch." }),
    });
    assert.equal(kick.status, 202);
    const turn = await done;
    assert.equal(turn.status, "ready");
    // The rewrite is NOT applied — it is surfaced as a pending proposal.
    assert.deepEqual(turn.changes ?? [], []);
    assert.deepEqual(turn.pending_rewrite, {
      interestId: "int_abc123",
      topic: "ai safety",
      doc: "brand new doc",
    });

    // The doc on disk is byte-identical until the user presses [Apply].
    assert.equal(await readInterestDoc("int_abc123", interestsDir), "old doc");
    const state = await loadState(stateFile);
    assert.deepEqual(state.last_chat?.pending_rewrite, {
      interestId: "int_abc123",
      topic: "ai safety",
      doc: "brand new doc",
    });
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat/confirm-rewrite writes the STORED proposed doc and returns a ready turn (PER-235)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
    last_chat: {
      id: "chat_proposal1",
      created_at: new Date().toISOString(),
      status: "ready",
      message: "Completely rewrite ai safety from scratch.",
      reply: "Here's a full rewrite — review and Apply below.",
      changes: [],
      pending_rewrite: {
        interestId: "int_abc123",
        topic: "ai safety",
        doc: "brand new doc",
      },
    },
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);

  // confirm-rewrite is deterministic — no model round-trip. Spawn must never run.
  const { spawnFn, calls } = makeChatSpawn({ output: "{}", autoClose: true });
  const { onChatDone, done } = awaitTurn();

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/v0/chat/confirm-rewrite`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ interestId: "int_abc123" }),
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { turn?: ChatTurn };
    assert.ok(body.turn, "confirm-rewrite returned a turn");
    assert.equal(body.turn!.status, "ready");
    // The applied change carries the STORED doc, through the same confirmed-
    // write seam an update takes (so the FE flashes the docs-rail card).
    assert.deepEqual(body.turn!.changes, [
      {
        interestId: "int_abc123",
        op: "update",
        topic: "ai safety",
        doc: "brand new doc",
      },
    ]);

    const turn = await done; // onChatDone fired with the same ready turn
    assert.equal(turn.status, "ready");

    assert.equal(
      await readInterestDoc("int_abc123", interestsDir),
      "brand new doc",
    );
    assert.equal(calls.length, 0, "confirm-rewrite must not spawn the model");

    // The proposal turn was replaced in the slot — a second [Apply] from a
    // stale card finds no pending rewrite and 404s (no double-write channel).
    const again = await fetch(
      `http://127.0.0.1:${port}/v0/chat/confirm-rewrite`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ interestId: "int_abc123" }),
      },
    );
    assert.equal(again.status, 404);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/chat/confirm-rewrite returns 404 when no pending rewrite matches (nothing written)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);
  const { spawnFn } = makeChatSpawn({ output: "{}", autoClose: true });

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/v0/chat/confirm-rewrite`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ interestId: "int_abc123" }),
      },
    );
    assert.equal(res.status, 404);
    assert.equal(await readInterestDoc("int_abc123", interestsDir), "old doc");
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
    changes: [
      { op: "update", interestId: "int_evil99", doc: "should not be written" },
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
  const { spawnFn, releaseAll } = makeChatSpawn({
    output: model,
    autoClose: false,
  });
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

test("POST /v0/chat accepts a new turn after a restart leaves only a persisted pending turn", async () => {
  const staleTurn: ChatTurn = {
    id: "chat_stale",
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    status: "pending",
    message: "stale before restart",
  };
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
    last_chat: staleTurn,
  });
  const model = JSON.stringify({ reply: "ok", changes: [] });
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
      body: JSON.stringify({ message: "new after restart" }),
    });

    assert.equal(kick.status, 202);
    const body = (await kick.json()) as { turn_id: string };
    assert.notEqual(body.turn_id, staleTurn.id);

    const landed = await done;
    assert.equal(landed.id, body.turn_id);
    assert.equal(landed.status, "ready");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("startChatTurn clears the in-flight guard if persisting the pending turn fails", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-chat-fail-"));
  const stateFile = path.join(tmp, "state.json");
  const unwritableStateFile = path.join(tmp, "as-directory");
  const interestsDir = path.join(tmp, "interests");
  await fs.mkdir(unwritableStateFile);
  await saveState({ pairing_token: newPairingToken() }, stateFile);

  try {
    await assert.rejects(
      startChatTurn("hello", { stateFile: unwritableStateFile, interestsDir }),
    );
    assert.equal(
      isChatInFlight(),
      false,
      "failed setup must not wedge future chat turns as in-flight",
    );

    const model = JSON.stringify({ reply: "ok", changes: [] });
    const { spawnFn } = makeChatSpawn({ output: model, autoClose: true });
    const { onChatDone, done } = awaitTurn();
    const outcome = await startChatTurn("hello again", {
      stateFile,
      interestsDir,
      spawnFn,
      onChatDone,
    });
    assert.equal(outcome.started, true);
    const landed = await done;
    assert.equal(landed.status, "ready");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("AIR-540: a hung chat child times out, lands the turn failed, and clears the in-flight guard", async () => {
  const { tmp, stateFile, interestsDir } = await seeded();

  // A child that never emits `close` (autoClose:false queues `finish` but never
  // releases it) — the exact hang the per-turn timeout guards against. Without
  // the timeout, runChatTurn's `finally` never runs and `chatInFlight` stays true
  // for the process lifetime, 409-ing every later chat request.
  const { spawnFn, calls } = makeChatSpawn({ output: "", autoClose: false });
  const { onChatDone, done } = awaitTurn();

  try {
    const outcome = await startChatTurn("please refine", {
      stateFile,
      interestsDir,
      spawnFn,
      timeoutMs: 50,
      onChatDone,
    });
    assert.equal(outcome.started, true);

    // `done` resolves only after runChatTurn's `finally` clears chatInFlight, so
    // awaiting it both settles the turn and releases the module-global guard
    // before the next test runs.
    const turn = await done;
    assert.equal(calls.length, 1, "the turn spawned exactly one claude child");
    assert.equal(turn.status, "failed", "a hung turn must land failed, not hang forever");
    assert.match(
      turn.error_msg ?? "",
      /timed out after 50ms/,
      "the failure names the per-turn timeout",
    );
    assert.equal(
      isChatInFlight(),
      false,
      "the timeout must release the in-flight guard so later turns aren't 409'd",
    );
  } finally {
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
    assert.match(
      ((await res.json()) as { error: string }).error,
      /message required/,
    );
    assert.equal(
      recorder.calls.length,
      0,
      "no claude child for a rejected message",
    );
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
    assert.ok(
      !JSON.stringify(call.args).includes(token),
      "token leaked into chat argv",
    );
    assert.ok(
      !JSON.stringify(call.options ?? {}).includes(token),
      "token leaked into chat spawn options/env",
    );
    assert.ok(
      !call.stdin.includes(token),
      "token leaked into the chat prompt (stdin)",
    );
    // The prompt carries the user's message + interest context, proving we
    // inspected a real prompt.
    assert.match(call.stdin, /quantum computing/);
    assert.match(call.stdin, /ai safety/);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// PER-230 AC6 #1: "delete is non-functional" was a model op-selection bug, not
// missing plumbing — the model rewrote/blanked the doc with `update` instead of
// emitting `delete`. The fix is prompt steering. This guards that the steering
// stays in the prompt so a future prompt edit can't silently regress delete.
test("buildChatPrompt steers removal intents to the delete op, not update (PER-230)", () => {
  const prompt = buildChatPrompt("delete my ai safety interest", [
    { id: "int_abc123", topic: "ai safety", doc: "Track alignment research." },
  ]);
  // Names removal verbs the user actually says, so the model maps them to delete.
  assert.match(prompt, /remove|delete|drop|get rid of|stop\s+tracking/i);
  // The load-bearing instruction: never fake a removal with an update.
  assert.match(prompt, /Deleting is the ONLY way to remove an interest/);
  assert.match(prompt, /NEVER try to/i);
});

// PER-231 #2: a `delete` is confirm-gated, so the model's reply must read as a
// pending request, not a done-action. Guards the prompt rule that stops the
// "Done — deleted X" / "Removed X" copy appearing before the user confirms.
test("buildChatPrompt tells the model a delete is confirm-gated and the reply must be a pending request (PER-231)", () => {
  const prompt = buildChatPrompt("delete my ai safety interest", [
    { id: "int_abc123", topic: "ai safety", doc: "Track alignment research." },
  ]);
  assert.match(prompt, /CONFIRM-GATED/);
  // The model must NOT claim the delete is done before confirmation.
  assert.match(prompt, /PENDING REQUEST/);
  assert.match(prompt, /NEVER claim it is done/i);
});

// PER-232 (AC3/AC5 CRITICAL): Stop must abort the SERVER-side turn. The QA fail
// was exactly this shape: Stop fired while the model child was in flight, the
// client poll was dropped, and the completed edit still persisted ~14s later.
// Here the child hangs (autoClose:false), we POST /v0/chat/stop, then release
// the child's (full-rewrite) output — the turn must land stopped with NO write
// to the interest doc and the interest set untouched.
test("POST /v0/chat/stop aborts the in-flight turn — no doc edit is committed (PER-232)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);

  const model = JSON.stringify({
    reply: "Rewrote your doc into three long paragraphs.",
    changes: [
      { op: "update", interestId: "int_abc123", doc: "full rewrite, much longer" },
    ],
  });
  const { spawnFn, releaseAll } = makeChatSpawn({
    output: model,
    autoClose: false,
  });
  // Two turns land in this test (the stopped one + the follow-up proving the
  // slot freed), so queue landings instead of the single-shot awaitTurn.
  const landings: ChatTurn[] = [];
  const waiters: Array<(t: ChatTurn) => void> = [];
  const nextLanding = () =>
    new Promise<ChatTurn>((resolve) => {
      const queued = landings.shift();
      if (queued) resolve(queued);
      else waiters.push(resolve);
    });

  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone: (t) => {
      const w = waiters.shift();
      if (w) w(t);
      else landings.push(t);
    },
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "rewrite my ai safety doc" }),
    });
    assert.equal(kick.status, 202);
    const turnId = ((await kick.json()) as { turn_id: string }).turn_id;

    // Stop while the child is unambiguously in flight.
    const stop = await fetch(`http://127.0.0.1:${port}/v0/chat/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ turn_id: turnId }),
    });
    assert.equal(stop.status, 200);
    assert.equal(((await stop.json()) as { stopped: boolean }).stopped, true);

    // The late-commit race: the model output still arrives AFTER the stop.
    releaseAll();

    const landed = await nextLanding();
    assert.equal(landed.id, turnId);
    assert.equal(landed.status, "failed");
    assert.match(landed.error_msg ?? "", /Stopped — no changes were applied/);

    // THE acceptance: nothing was committed despite the completed model output.
    assert.equal(await readInterestDoc("int_abc123", interestsDir), "old doc");
    const after = await loadState(stateFile);
    assert.deepEqual(after.interests, [{ id: "int_abc123", topic: "ai safety" }]);
    assert.equal(after.last_chat?.status, "failed");

    // The slot is free again: a new turn is accepted (no stuck pending state).
    const again = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "hello again" }),
    });
    assert.equal(again.status, 202);

    // Land the follow-up turn too — chat.ts holds module-level in-flight state,
    // so leaving it pending would leak an abortable turn into the next test.
    // The child's stdin lands asynchronously after the 202, so keep releasing
    // until the turn arrives.
    const landing = nextLanding();
    let followUp: ChatTurn | undefined;
    while (!followUp) {
      releaseAll();
      followUp = (await Promise.race([
        landing,
        new Promise<undefined>((r) => setTimeout(r, 10)),
      ])) as ChatTurn | undefined;
    }
    assert.equal(followUp.status, "ready");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// A stale Stop (wrong turn id) and a Stop with nothing in flight are both
// harmless no-ops — they must never abort a turn they don't name.
test("POST /v0/chat/stop is a no-op for a stale turn id or no in-flight turn (PER-232)", async () => {
  const { tmp, stateFile, interestsDir, token } = await seeded({
    interests: [{ id: "int_abc123", topic: "ai safety" }],
  });
  await writeInterestDoc("int_abc123", "old doc", interestsDir);
  const model = JSON.stringify({
    reply: "ok",
    changes: [
      { op: "update", interestId: "int_abc123", doc: "legit edit" },
    ],
  });
  const { spawnFn, releaseAll } = makeChatSpawn({
    output: model,
    autoClose: false,
  });
  const { onChatDone, done } = awaitTurn();
  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
    onChatDone,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    // Nothing in flight yet → stopped:false.
    const idle = await fetch(`http://127.0.0.1:${port}/v0/chat/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: "{}",
    });
    assert.equal(idle.status, 200);
    assert.equal(((await idle.json()) as { stopped: boolean }).stopped, false);

    const kick = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "refine my doc" }),
    });
    assert.equal(kick.status, 202);

    // A stale id must NOT abort the newer in-flight turn.
    const stale = await fetch(`http://127.0.0.1:${port}/v0/chat/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ turn_id: "chat_stale_999" }),
    });
    assert.equal(stale.status, 200);
    assert.equal(((await stale.json()) as { stopped: boolean }).stopped, false);

    // The child's stdin lands asynchronously after the 202, so keep releasing
    // until the turn arrives.
    let landed: ChatTurn | undefined;
    while (!landed) {
      releaseAll();
      landed = (await Promise.race([
        done,
        new Promise<undefined>((r) => setTimeout(r, 10)),
      ])) as ChatTurn | undefined;
    }
    assert.equal(landed.status, "ready");
    assert.equal(
      await readInterestDoc("int_abc123", interestsDir),
      "legit edit",
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// CAR-195: a corrupt-but-present transcript must be preserved, not silently
// overwritten. Before, readChatTranscript mapped a parse error to [] and the very
// next append wiped the file — permanent chat-history loss on one bad read.
test("CAR-195: a corrupt transcript is backed up to .corrupt-*.bak, not wiped", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-chat-corrupt-"));
  try {
    const file = path.join(tmp, "transcript.json");
    const corruptBytes = '[{"id":"chat_1","created_at":"2026-01-01T00:00:00Z" CORRUPT';
    await fs.writeFile(file, corruptBytes);

    // Corrupt JSON reads as an empty transcript (callers degrade gracefully)...
    const turns = await readChatTranscript(file);
    assert.deepEqual(turns, []);

    // ...but the original bytes survive under a .corrupt-*.bak sibling, and the
    // original path is freed so the next write starts clean instead of clobbering.
    const siblings = await fs.readdir(tmp);
    const backup = siblings.find((f) => f.includes(".corrupt-") && f.endsWith(".bak"));
    assert.ok(backup, "expected a .corrupt-*.bak backup of the unparseable transcript");
    assert.equal(await fs.readFile(path.join(tmp, backup!), "utf8"), corruptBytes);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// CAR-195: the common no-file case stays quiet (no spurious backup, returns []).
test("CAR-195: a missing transcript returns [] without creating a backup", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-chat-missing-"));
  try {
    const file = path.join(tmp, "transcript.json");
    assert.deepEqual(await readChatTranscript(file), []);
    assert.deepEqual(await fs.readdir(tmp), []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("CAR-146: a non-ENOENT transcript read failure logs and returns []", async () => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const file = path.join("/dev/null", "transcript.json");
    assert.deepEqual(await readChatTranscript(file), []);
  } finally {
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  assert.match(
    String(calls[0][0]),
    /^\[chat\] transcript .* could not be read:/,
  );
  assert.equal((calls[0][1] as NodeJS.ErrnoException).code, "ENOTDIR");
});

// Bug-hunt regression: a literal JSON `null` body (valid JSON, but not an
// object) must yield a clean 400, not a 500. Before the parseJsonBody fix,
// `JSON.parse("null")` returned `null`, which the handler then dereferenced
// (`parsed.message`) → uncaught TypeError → 500 with a leaked error. Every
// mutating /v0 route shares parseJsonBody, so exercising one proves the guard.
test("POST /v0/chat with a literal `null` JSON body returns 400, not 500", async () => {
  const { stateFile, interestsDir, token } = await seeded();
  const { spawnFn } = makeChatSpawn({ output: "{}", autoClose: true });
  const { server, port } = await startServer(0, {
    stateFile,
    interestsDir,
    spawnFn,
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "null",
    });
    // `null` body → treated as an empty object → "message required" (400).
    assert.equal(res.status, 400);
    const parsed = (await res.json()) as { error: string };
    assert.equal(parsed.error, "message required");
  } finally {
    server.close();
  }
});
