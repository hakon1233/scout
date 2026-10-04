// The offline eval runs in the normal suite too: every recorded output must
// fail exactly the checks its case names, so a check that stops catching its
// failure (or a good output that starts failing) shows up here.

import test from "node:test";
import assert from "node:assert/strict";
import { runEval } from "../eval/run.js";

test("every eval case fails exactly its expected checks", async () => {
  const results = await runEval();
  assert.ok(results.length > 0);
  for (const r of results) {
    const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
    assert.deepEqual(
      failed.sort(),
      [...r.expectFail].sort(),
      `${r.kind}/${r.name}`,
    );
  }
});
