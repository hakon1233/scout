import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveAppShellFallback,
  resolveStatic,
  trailingSlashRedirect,
} from "../src/static.js";

async function tmpWebroot(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-static-"));
  await fs.writeFile(path.join(tmp, "index.html"), "<h1>Home</h1>");
  await fs.mkdir(path.join(tmp, "app"), { recursive: true });
  await fs.writeFile(path.join(tmp, "app", "index.html"), "<h1>App</h1>");
  return tmp;
}

test("malformed percent-encoded paths are static misses, not thrown errors", async () => {
  const root = await tmpWebroot();
  try {
    await assert.doesNotReject(() => resolveStatic("/%E0%A4%A", root));
    await assert.doesNotReject(() => trailingSlashRedirect("/%E0%A4%A", root));
    await assert.doesNotReject(() => resolveAppShellFallback("/app/%E0%A4%A", root));

    assert.equal(await resolveStatic("/%E0%A4%A", root), null);
    assert.equal(await trailingSlashRedirect("/%E0%A4%A", root), null);
    assert.equal(await resolveAppShellFallback("/app/%E0%A4%A", root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
