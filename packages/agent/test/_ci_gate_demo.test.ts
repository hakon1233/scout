import { test } from "node:test";
import assert from "node:assert/strict";

// TEMPORARY (PER-120 acceptance demo): deliberately failing test to prove a red
// suite blocks the Pages deploy. Reverted in the immediately following commit.
test("PER-120 deploy-gate demo — intentionally failing", () => {
  assert.equal(1, 2, "intentional failure to demonstrate the CI gate blocks deploy");
});
