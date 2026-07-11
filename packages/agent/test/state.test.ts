// State persistence tests (AIR-356). Hermetic: temp files only, no network,
// no Claude quota.
//
// Covered:
//   - A corrupt-but-present state.json is backed up to a `.corrupt-*.bak`
//     sibling before loadState falls back to {}, so the very next saveState
//     can't permanently wipe the founder's interests/briefs/pairing token.
//     Symmetric with chat.ts CAR-195 (corrupt transcript preservation).
//   - A missing state file (normal first run) is NOT backed up — there is
//     nothing to preserve.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadState, saveState } from "../src/state.js";

test("AIR-356: a corrupt state.json is backed up to .corrupt-*.bak, not wiped", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-corrupt-"));
  try {
    const file = path.join(tmp, "state.json");
    const corruptBytes = '{"interests":[{"id":"i1","topic":"AI" CORRUPT';
    await fs.writeFile(file, corruptBytes);

    // loadState degrades to empty state so the companion still boots...
    const state = await loadState(file);
    assert.deepEqual(state, {}, "corrupt state should load as empty");

    // ...but the original bytes survive under a .corrupt-*.bak sibling, so the
    // founder's config is recoverable rather than silently destroyed.
    const siblings = await fs.readdir(tmp);
    const backup = siblings.find(
      (f) => f.includes(".corrupt-") && f.endsWith(".bak"),
    );
    assert.ok(backup, "expected a .corrupt-*.bak backup of the unparseable state");
    assert.equal(await fs.readFile(path.join(tmp, backup!), "utf8"), corruptBytes);

    // And the now-absent state.json is free for a clean save (the dangerous
    // path: without the backup this save would have overwritten the corrupt
    // file and lost its contents forever).
    await saveState({ pairing_token: "tok_fresh" }, file);
    assert.equal((await loadState(file)).pairing_token, "tok_fresh");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("AIR-356: a missing state.json is not backed up (normal first run)", async () => {
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
