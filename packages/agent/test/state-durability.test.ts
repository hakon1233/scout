// Kill-during-write durability regression tests for state.json (PER-270).
//
// PER-270 (audit finding C1) originally asked for a test capturing the
// PRE-fix behavior: a non-atomic saveState + an error-swallowing loadState
// meant a crash mid-write left a truncated state.json that the next load
// silently replaced with {} — wiping the pairing token, interests, and brief
// history. That fix has since landed (AIR-163 atomic writes, AIR-356 corrupt
// backup, CAR-244 persistence seam), so the pre-fix behavior no longer exists
// to capture. These tests instead pin the POST-fix durability contract so it
// cannot silently regress — which is the safety net PER-270 was for:
//
//   - A torn write artifact (state.json truncated mid-JSON, exactly what a
//     killed non-atomic writer leaves behind) must be preserved as a
//     .corrupt-*.bak sibling, never silently absorbed into a fresh {}.
//   - A saveState that FAILS mid-write must leave the previous state.json
//     byte-for-byte intact (the temp+rename seam in persistence.ts is what
//     guarantees this; reverting it to a plain writeFile fails these tests).
//   - A saveState that succeeds must leave no *.tmp residue behind.
//   - Concurrent savers must never produce a torn/interleaved file — the
//     result is always exactly one complete payload (last rename wins).
//
// Complements state.test.ts (AIR-356: garbage-bytes corruption + first-run)
// and chat.test.ts (CAR-195). Hermetic: temp files only, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadState, saveState, type State } from "../src/state.js";

const RICH_STATE: State = {
  pairing_token: "tok_survivor",
  interests: [
    { id: "i1", topic: "AI safety" },
    { id: "i2", topic: "Norwegian startups" },
  ],
};

test("PER-270: a truncated (kill-during-write) state.json is preserved, not silently reset", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-torn-"));
  try {
    const file = path.join(tmp, "state.json");
    await saveState(RICH_STATE, file);
    const full = await fs.readFile(file, "utf8");

    // Simulate the artifact a killed non-atomic writer leaves: a valid JSON
    // prefix cut off mid-document. (saveState itself can no longer produce
    // this — that is the point — but a pre-atomic version, a disk fault, or a
    // truncating restore still can.)
    const torn = full.slice(0, Math.floor(full.length / 2));
    await fs.writeFile(file, torn);

    // The companion still boots (degrades to empty state)...
    assert.deepEqual(await loadState(file), {});

    // ...but the torn bytes survive in a .corrupt-*.bak sibling. This is the
    // assertion that fails on the pre-fix code, where the torn file stayed in
    // place waiting for the next saveState to destroy it.
    const siblings = await fs.readdir(tmp);
    const backup = siblings.find(
      (f) => f.includes(".corrupt-") && f.endsWith(".bak"),
    );
    assert.ok(backup, "expected the torn state.json preserved as .corrupt-*.bak");
    assert.equal(await fs.readFile(path.join(tmp, backup!), "utf8"), torn);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test(
  "PER-270: a saveState that fails mid-write leaves the previous state intact",
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

test("PER-270: a successful saveState leaves no temp-file residue", async () => {
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

test("PER-270: concurrent saves never tear the file — one complete payload wins", async () => {
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
