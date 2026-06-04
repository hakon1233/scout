// Per-interest id + intent-doc store tests (PER-169).
//
// Covers the acceptance for C1:
//   - existing `state.json` (legacy string[] interests) migrates WITHOUT loss,
//     with stable, filename-safe ids;
//   - a persisted doc round-trips by id and is loadable;
//   - `interestDocMeta` reports hasDoc/updatedAt straight from the filesystem;
//   - `reconcileInterests` preserves an interest's id (so its doc stays
//     attached) across reorder / rename / add / remove;
//   - GET /v0/interests serves the {id, topic, hasDoc, docUpdatedAt} contract
//     the profile doc-indicator (PER-170 fetchInterestDocMeta) consumes.
//
// Hermetic: pure functions + a tmp doc dir; the one server test mocks the
// claude shell-out via startServer's spawnFn override. No network, no quota.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  migrateInterests,
  reconcileInterests,
  interestTopics,
  legacyInterestId,
  newInterestId,
  newPairingToken,
  saveState,
  loadState,
  type State,
} from "../src/state.js";
import {
  writeInterestDoc,
  readInterestDoc,
  deleteInterestDoc,
  interestDocMeta,
  interestDocPath,
} from "../src/docs.js";
import { startServer } from "../src/server.js";

async function tmpDir(prefix = "scout-docs-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

// ── Migration ───────────────────────────────────────────────────────────────

test("migrateInterests lifts legacy string[] to {id, topic} losslessly + stably", () => {
  const legacy = ["ai safety", "  markets  ", "f1"];
  const out = migrateInterests(legacy);
  // No topic dropped; whitespace trimmed; order preserved.
  assert.deepEqual(
    out.map((i) => i.topic),
    ["ai safety", "markets", "f1"],
  );
  // Every entry has a filename-safe id…
  for (const it of out) {
    assert.match(it.id, /^int_[A-Za-z0-9_-]+$/);
  }
  // …and the id is deterministic for legacy data (re-migrating yields the same
  // ids, so an unpersisted state.json doesn't drift across loads).
  const again = migrateInterests(legacy);
  assert.deepEqual(
    again.map((i) => i.id),
    out.map((i) => i.id),
  );
  assert.equal(out[0].id, legacyInterestId("ai safety"));
});

test("migrateInterests drops empty/blank topics but keeps everything real", () => {
  const out = migrateInterests(["", "   ", "real"]);
  assert.deepEqual(
    out.map((i) => i.topic),
    ["real"],
  );
});

test("migrateInterests passes through the rich {id, topic} shape unchanged", () => {
  const rich = [{ id: "int_keep", topic: "ai" }];
  const out = migrateInterests(rich);
  assert.deepEqual(out, [{ id: "int_keep", topic: "ai" }]);
});

test("migrateInterests never collapses two topics onto one id (collision-safe)", () => {
  // Two object entries that declare the SAME id must both survive — the second
  // gets suffixed rather than silently overwriting the first.
  const out = migrateInterests([
    { id: "int_dupe", topic: "first" },
    { id: "int_dupe", topic: "second" },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((i) => i.topic),
    ["first", "second"],
  );
  assert.notEqual(out[0].id, out[1].id);
});

test("migrateInterests tolerates a non-array (corrupt) value", () => {
  assert.deepEqual(migrateInterests(undefined), []);
  assert.deepEqual(migrateInterests("nope"), []);
  assert.deepEqual(migrateInterests({}), []);
});

test("loadState migrates a legacy on-disk state.json to the rich model", async () => {
  const dir = await tmpDir();
  try {
    const file = path.join(dir, "state.json");
    // Hand-write the OLD shape (string[]) exactly as a pre-PER-169 companion did.
    await fs.writeFile(
      file,
      JSON.stringify({ pairing_token: "tok", interests: ["ai safety", "nba"] }),
    );
    const state = await loadState(file);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.topic),
      ["ai safety", "nba"],
    );
    assert.ok(
      (state.interests ?? []).every((i) => typeof i.id === "string" && i.id),
    );
    // Absent interests stay absent (distinct from an empty list).
    await fs.writeFile(
      path.join(dir, "s2.json"),
      JSON.stringify({ pairing_token: "t" }),
    );
    const s2 = await loadState(path.join(dir, "s2.json"));
    assert.equal(s2.interests, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── Reconcile (id preservation across edits) ─────────────────────────────────

test("reconcileInterests preserves an existing topic's id across reorder/add/remove", () => {
  const existing = [
    { id: "int_a", topic: "ai safety" },
    { id: "int_b", topic: "markets" },
  ];
  // Reorder + add a new topic + drop none.
  const out = reconcileInterests(existing, ["markets", "ai safety", "rust"]);
  const byTopic = new Map(out.map((i) => [i.topic, i.id]));
  assert.equal(
    byTopic.get("ai safety"),
    "int_a",
    "id stays attached across reorder",
  );
  assert.equal(byTopic.get("markets"), "int_b");
  assert.match(byTopic.get("rust")!, /^int_/);
  assert.notEqual(byTopic.get("rust"), "int_a");
});

test("reconcileInterests matches topics case-insensitively (keeps the id)", () => {
  const existing = [{ id: "int_a", topic: "AI Safety" }];
  const out = reconcileInterests(existing, ["ai safety"]);
  assert.equal(out[0].id, "int_a");
});

test("interestTopics is the topic-only engine boundary", () => {
  assert.deepEqual(
    interestTopics([
      { id: "x", topic: "a" },
      { id: "y", topic: "b" },
    ]),
    ["a", "b"],
  );
  assert.deepEqual(interestTopics(undefined), []);
});

// ── Doc store round-trip ─────────────────────────────────────────────────────

test("a doc round-trips by id (write → read), survives across calls", async () => {
  const dir = await tmpDir();
  try {
    const id = newInterestId();
    assert.equal(
      await readInterestDoc(id, dir),
      null,
      "no doc yet → null, not throw",
    );
    await writeInterestDoc(id, "# intent\nonly deep-dive papers", dir);
    assert.equal(
      await readInterestDoc(id, dir),
      "# intent\nonly deep-dive papers",
    );
    // Overwrite is a plain replace.
    await writeInterestDoc(id, "changed", dir);
    assert.equal(await readInterestDoc(id, dir), "changed");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("doc files are written owner-only (0600) in a 0700 dir", async () => {
  const dir = await tmpDir();
  try {
    const id = newInterestId();
    await writeInterestDoc(id, "secret intent", dir);
    const fileMode = (await fs.stat(interestDocPath(id, dir))).mode & 0o777;
    const dirMode = (await fs.stat(dir)).mode & 0o777;
    assert.equal(fileMode, 0o600, "doc file is owner read/write only");
    assert.equal(dirMode, 0o700, "interests dir is owner-only");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deleteInterestDoc removes the doc and is idempotent", async () => {
  const dir = await tmpDir();
  try {
    const id = newInterestId();
    await writeInterestDoc(id, "x", dir);
    await deleteInterestDoc(id, dir);
    assert.equal(await readInterestDoc(id, dir), null);
    // Second delete is a no-op, never an error.
    await deleteInterestDoc(id, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("interestDocMeta reflects real filesystem state (hasDoc + updatedAt)", async () => {
  const dir = await tmpDir();
  try {
    const id = newInterestId();
    const before = await interestDocMeta(id, dir);
    assert.deepEqual(before, { hasDoc: false });
    await writeInterestDoc(id, "x", dir);
    const after = await interestDocMeta(id, dir);
    assert.equal(after.hasDoc, true);
    assert.ok(after.updatedAt, "updatedAt present once the doc exists");
    // updatedAt is a valid ISO string (the doc's mtime).
    assert.ok(!Number.isNaN(Date.parse(after.updatedAt!)));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("interestDocPath refuses a path-traversal / hostile id", () => {
  assert.throws(() => interestDocPath("../escape"), /unsafe interest id/);
  assert.throws(() => interestDocPath("a/b"), /unsafe interest id/);
  assert.throws(() => interestDocPath(""), /unsafe interest id/);
});

// ── GET /v0/interests payload contract (PER-169 / PER-170) ────────────────────

test("GET /v0/interests serves {id, topic, hasDoc, docUpdatedAt, doc} on real doc state", async () => {
  const tmp = await tmpDir("scout-docs-srv-");
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  // Two interests with KNOWN ids so we can drop a doc for exactly one of them.
  const withDoc = { id: "int_withdoc", topic: "ai safety" };
  const noDoc = { id: "int_nodoc", topic: "markets" };
  await saveState(
    { pairing_token: token, interests: [withDoc, noDoc] } as State,
    stateFile,
  );
  // Drop a doc for the first interest in a hermetic doc dir and inject that same
  // dir into the server — so GET /v0/interests reads OUR docs, never the
  // developer's real ~/.config/scout/interests.
  const interestsDir = path.join(tmp, "interests");
  await writeInterestDoc(withDoc.id, "# only alignment", interestsDir);

  const { server, port } = await startServer(0, { stateFile, interestsDir });
  try {
    const unauth = await fetch(`http://127.0.0.1:${port}/v0/interests`);
    assert.equal(
      unauth.status,
      401,
      "GET /v0/interests requires the pairing token",
    );

    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      interests: Array<{
        id: string;
        topic: string;
        hasDoc: boolean;
        docUpdatedAt: string | null;
        doc: string | null;
      }>;
    };
    assert.deepEqual(
      body.interests.map((i) => i.topic),
      ["ai safety", "markets"],
    );
    assert.deepEqual(
      body.interests.map((i) => i.id),
      ["int_withdoc", "int_nodoc"],
    );
    const ai = body.interests.find((i) => i.id === "int_withdoc")!;
    const mk = body.interests.find((i) => i.id === "int_nodoc")!;
    assert.equal(
      ai.hasDoc,
      true,
      "interest with a persisted doc reports hasDoc:true",
    );
    assert.ok(ai.docUpdatedAt, "and a docUpdatedAt timestamp");
    assert.equal(ai.doc, "# only alignment");
    assert.equal(
      mk.hasDoc,
      false,
      "interest without a doc reports hasDoc:false",
    );
    assert.equal(mk.docUpdatedAt, null);
    assert.equal(mk.doc, null);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
