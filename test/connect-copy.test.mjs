import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Connect companion-fetch failure shows fixed user copy and logs raw detail", async () => {
  const source = await readFile("src/app/app/connect/page.tsx", "utf8");

  assert.match(
    source,
    /console\.error\("Failed to post interests to companion", err\);/,
    "raw companion-fetch failures should be logged for debugging",
  );
  assert.match(
    source,
    /const message = err instanceof Error \? err\.message : "";/,
    "the catch branch should inspect the thrown Error message",
  );
  assert.match(
    source,
    /const reachableFailure =\s+\/network\|fetch\|reach\|connect\|companion not reachable\/i\.test\(message\);/,
    "network-style failures should remain grouped under the fixed recovery hint",
  );
  assert.match(
    source,
    /setGenMsg\(\s+reachableFailure\s+\? "Could not reach the companion\. Make sure `scout-agent run` is running on this machine\."\s+:\s+message \|\| "The companion rejected this run\.",\s+\);/,
    "user-facing copy should be a fixed recovery hint",
  );
  assert.doesNotMatch(
    source,
    /setGenMsg\(`Could not reach companion: \$\{String\(err\)\}`\)/,
    "user-facing copy must not leak raw JavaScript error strings",
  );
});

test("Connect companion rejection is not mislabeled as unreachable", async () => {
  const source = await readFile("src/app/app/connect/page.tsx", "utf8");

  assert.match(
    source,
    /reachableFailure\s+\?\s+"Could not reach the companion\./,
    "the generic reachability copy should only be used for network-like failures",
  );
  assert.match(
    source,
    /:\s+message \|\| "The companion rejected this run\."/,
    "server-provided rejection messages, such as the wipe guard, should reach the user",
  );
});
