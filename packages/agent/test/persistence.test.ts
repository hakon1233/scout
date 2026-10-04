// The companion's real state lives in the user's ~/.config/scout. A test that
// forgets to pass a temp path must fail loudly, never write there.

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { assertNotRealStateUnderTest } from "../src/persistence.js";

const realConfig = path.join(os.userInfo().homedir, ".config", "scout");

test("under a test runner, a path inside the real ~/.config/scout is refused", () => {
  for (const file of [
    path.join(realConfig, "state.json"),
    path.join(realConfig, "chat", "transcript.json"),
    realConfig,
  ]) {
    assert.throws(() => assertNotRealStateUnderTest(file), /Refusing to touch/);
  }
});

test("under a test runner, temp paths and look-alike siblings are allowed", () => {
  assert.doesNotThrow(() =>
    assertNotRealStateUnderTest(
      path.join(os.tmpdir(), "scout-x", "state.json"),
    ),
  );
  assert.doesNotThrow(() =>
    assertNotRealStateUnderTest(`${realConfig}-other/state.json`),
  );
});
