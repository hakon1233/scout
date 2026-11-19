// POST /v0/weekly-brief: the companion saves the weekly digest (built in
// packages/core) into history.

import test from "node:test";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Brief } from "#core";
import { loadState, newPairingToken, saveState } from "../src/state.js";
import { startServer } from "../src/server.js";

function dailyBrief(
  id: string,
  generatedAt: string,
  topic: string,
  items: string[],
): Brief {
  return {
    id,
    generated_at: generatedAt,
    status: "ready",
    kind: "daily",
    summary_md: `# Your brief\n\n## ${topic}\n${items.join("\n")}`,
  };
}

const storyA = [
  "- `2026-06-14` — OpenAI shipped a new agent release.",
  "  [openai.com — Agent release](https://example.com/agent)",
  "  > Useful detail.",
].join("\n");
const storyB = [
  "- `2026-06-12` — Anthropic published an evals update.",
  "  [anthropic.com — Evals](https://example.com/evals)",
].join("\n");

test("POST /v0/weekly-brief persists a weekly brief into history without mutating interests", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-weekly-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  const interests = [{ id: "int_ai", topic: "AI" }];
  await saveState(
    {
      pairing_token: token,
      interests,
      briefs: [
        dailyBrief("latest", "2026-06-15T07:00:00.000Z", "AI", [
          storyA,
          storyB,
        ]),
      ],
    },
    stateFile,
  );

  const { server, port } = await startServer(0, { stateFile });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/weekly-brief`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { brief: Brief };
    assert.equal(body.brief.kind, "weekly");

    const state = await loadState(stateFile);
    assert.equal(state.last_brief?.kind, "weekly");
    assert.equal(state.briefs?.[0]?.id, body.brief.id);
    assert.deepEqual(state.interests, interests);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/weekly-brief answers 409 while a run is in flight and leaves its slot alone", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-weekly-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  await saveState(
    { pairing_token: token, interests: [{ id: "int_ai", topic: "AI" }] },
    stateFile,
  );

  // A research child that answers only when released.
  let respond = () => {};
  let markSpawned = () => {};
  const spawned = new Promise<void>((r) => (markSpawned = r));
  const spawnFn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write: (_c, _e, cb) => cb() });
    respond = () => {
      child.stdout.emit(
        "data",
        Buffer.from(
          "## AI\n- `2026-06-15` — A story.\n  [a.com — A](https://a.com/a)\n",
        ),
      );
      child.emit("close", 0);
    };
    markSpawned();
    return child;
  }) as unknown as typeof spawn;
  let synthesized = () => {};
  const done = new Promise<void>((r) => (synthesized = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: () => synthesized(),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const run = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ interests: ["AI"] }),
    });
    assert.equal(run.status, 202);
    const { brief_id } = (await run.json()) as { brief_id: string };

    const weekly = await fetch(`http://127.0.0.1:${port}/v0/weekly-brief`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(weekly.status, 409);
    const slot = (await loadState(stateFile)).last_brief;
    assert.equal(slot?.id, brief_id);
    assert.equal(slot?.status, "pending");
  } finally {
    await spawned;
    respond();
    await done;
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
