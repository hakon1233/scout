// state.json durability: corrupt files are kept as .corrupt-*.bak, saves are
// atomic, and concurrent writers never tear or lose an update.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listCorruptStateBackups,
  loadState,
  saveState,
  updateState,
  type State,
} from "../src/state.js";
import { startServer } from "../src/server.js";

const RICH_STATE: State = {
  pairing_token: "tok_survivor",
  interests: [
    { id: "i1", topic: "AI safety" },
    { id: "i2", topic: "Norwegian startups" },
  ],
};

test("a corrupt state.json is backed up to .corrupt-*.bak, not wiped", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-corrupt-"));
  try {
    const file = path.join(tmp, "state.json");
    const corruptBytes = '{"interests":[{"id":"i1","topic":"AI" CORRUPT';
    await fs.writeFile(file, corruptBytes);

    // loadState degrades to empty state so the companion still boots...
    const state = await loadState(file);
    assert.deepEqual(state, {}, "corrupt state should load as empty");

    // ...but the original bytes survive under a .corrupt-*.bak sibling, so the
    // user's config is recoverable rather than silently destroyed.
    const siblings = await fs.readdir(tmp);
    const backup = siblings.find(
      (f) => f.includes(".corrupt-") && f.endsWith(".bak"),
    );
    assert.ok(
      backup,
      "expected a .corrupt-*.bak backup of the unparseable state",
    );
    assert.equal(
      await fs.readFile(path.join(tmp, backup!), "utf8"),
      corruptBytes,
    );

    // And the now-absent state.json is free for a clean save (the dangerous
    // path: without the backup this save would have overwritten the corrupt
    // file and lost its contents forever).
    await saveState({ pairing_token: "tok_fresh" }, file);
    assert.equal((await loadState(file)).pairing_token, "tok_fresh");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a missing state.json is not backed up (normal first run)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-missing-"));
  try {
    const file = path.join(tmp, "state.json");
    const state = await loadState(file);
    assert.deepEqual(state, {}, "missing state should load as empty");

    const siblings = await fs.readdir(tmp);
    assert.equal(
      siblings.filter((f) => f.includes(".corrupt-")).length,
      0,
      "a never-written state file must not produce a .corrupt-*.bak",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test(
  "a saveState that fails mid-write leaves the previous state intact",
  // Root bypasses the permission bit this test uses to force the write failure.
  { skip: process.getuid?.() === 0 ? "meaningless as root" : false },
  async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-crash-"));
    try {
      const file = path.join(tmp, "state.json");
      await saveState(RICH_STATE, file);
      const before = await fs.readFile(file, "utf8");

      // Make the config dir unwritable so the sibling temp-file write fails —
      // the hermetic stand-in for dying mid-write (full disk, kill -9 between
      // open and write). With a plain writeFile this would tear state.json
      // itself; with the temp+rename seam the target is never opened at all.
      await fs.chmod(tmp, 0o500);
      try {
        await assert.rejects(saveState({ pairing_token: "tok_clobber" }, file));
      } finally {
        await fs.chmod(tmp, 0o700);
      }

      // Old state survives byte-for-byte and still loads.
      assert.equal(await fs.readFile(file, "utf8"), before);
      assert.equal((await loadState(file)).pairing_token, "tok_survivor");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  },
);

test("a successful saveState leaves no temp-file residue", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-residue-"));
  try {
    const file = path.join(tmp, "state.json");
    await saveState(RICH_STATE, file);
    await saveState({ ...RICH_STATE, pairing_token: "tok_rotated" }, file);

    assert.deepEqual(
      await fs.readdir(tmp),
      ["state.json"],
      "config dir must hold exactly state.json — no orphaned *.tmp siblings",
    );
    assert.equal((await loadState(file)).pairing_token, "tok_rotated");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("concurrent saves never tear the file — one complete payload wins", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-race-"));
  try {
    const file = path.join(tmp, "state.json");
    // Payloads of very different sizes so an interleaved/partial write (the
    // plain-writeFile failure mode) could not parse as any single one of them.
    const payloads: State[] = Array.from({ length: 10 }, (_, i) => ({
      pairing_token: `tok_${i}`,
      interests: Array.from({ length: i * 5 }, (_, j) => ({
        id: `i${i}_${j}`,
        topic: `topic ${i}.${j} ${"x".repeat(i * 20)}`,
      })),
    }));
    await Promise.all(payloads.map((p) => saveState(p, file)));

    // Whichever rename landed last, the file is one intact document that
    // deep-equals exactly one of the racing payloads.
    const final = await loadState(file);
    assert.ok(
      payloads.some((p) => {
        try {
          assert.deepEqual(final, p);
          return true;
        } catch {
          return false;
        }
      }),
      "final state must be exactly one racer's complete payload, never a blend",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("listCorruptStateBackups reports the recovery file a corrupt load leaves behind", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-recovery-"));
  try {
    const file = path.join(tmp, "state.json");

    // Nothing to report on a healthy store — or before the dir even exists.
    assert.deepEqual(
      await listCorruptStateBackups(
        path.join(tmp, "no-such-dir", "state.json"),
      ),
      [],
    );
    await saveState(RICH_STATE, file);
    assert.deepEqual(await listCorruptStateBackups(file), []);

    // Corrupt it; the recovering load must leave a discoverable backup.
    await fs.writeFile(file, "{ torn");
    await loadState(file);
    const backups = await listCorruptStateBackups(file);
    assert.equal(backups.length, 1);
    assert.match(backups[0]!, /^state\.json\.corrupt-\d+\.bak$/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("/healthz surfaces corrupt-state recoveries instead of a silent fresh boot", async () => {
  const tmp = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-health-recovery-"),
  );
  const stateFile = path.join(tmp, "state.json");
  await saveState(RICH_STATE, stateFile);
  const { server, port } = await startServer(0, { stateFile });
  try {
    // Healthy store: the field is present and explicitly null, so a consumer
    // can distinguish "no recovery happened" from "companion predates this
    // field".
    const clean = await (
      await fetch(`http://127.0.0.1:${port}/healthz`)
    ).json();
    assert.equal(clean.state_recovery, null);

    // Corrupt the file and trip the recovery path (any state read recovers it;
    // /healthz itself only OBSERVES backups, it never parses the state file).
    await fs.writeFile(stateFile, "{ torn");
    await loadState(stateFile);

    const after = await (
      await fetch(`http://127.0.0.1:${port}/healthz`)
    ).json();
    assert.equal(after.ok, true, "recovery is a warning, not unhealthiness");
    assert.equal(after.state_recovery.corrupt_backups, 1);
    assert.match(
      after.state_recovery.latest,
      /^state\.json\.corrupt-\d+\.bak$/,
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("concurrent updates to one state file each see the previous one's result", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-update-"));
  const file = path.join(tmp, "state.json");
  try {
    await saveState({ interests: [] }, file);
    // Twenty writers start at once; each appends one interest.
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        updateState(file, (s) => ({
          ...s,
          interests: [
            ...(s.interests ?? []),
            { id: `int_${n}`, topic: `t${n}` },
          ],
        })),
      ),
    );
    const saved = (await loadState(file)).interests ?? [];
    assert.equal(saved.length, 20);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a failed update does not block the next one", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-update-"));
  const file = path.join(tmp, "state.json");
  try {
    await assert.rejects(
      updateState(file, () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    await updateState(file, (s) => ({ ...s, pairing_token: "tok" }));
    assert.equal((await loadState(file)).pairing_token, "tok");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a state file that exists but can't be read is never replaced", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-unreadable-"));
  try {
    // A directory where state.json should be: readFile fails with EISDIR.
    const file = path.join(tmp, "state.json");
    await fs.mkdir(file);
    await assert.rejects(loadState(file));
    await assert.rejects(
      updateState(file, (s) => ({ ...s, pairing_token: "new" })),
    );
    assert.ok((await fs.stat(file)).isDirectory());
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
