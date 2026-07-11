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
    /setGenMsg\(\s*"Could not reach the companion\. Make sure `scout-agent run` is running on this machine\.",?\s*\);/,
    "user-facing copy should be a fixed recovery hint",
  );
  assert.doesNotMatch(
    source,
    /setGenMsg\(`Could not reach companion: \$\{String\(err\)\}`\)/,
    "user-facing copy must not leak raw JavaScript error strings",
  );
});
