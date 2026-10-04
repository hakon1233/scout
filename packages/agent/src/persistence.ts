// Generic filesystem persistence seam for the loopback companion.
//
// Everything the companion persists lives under `~/.config/scout` as owner-only
// files the user can inspect or delete — state.json, the chat transcript, and
// the per-interest intent docs. They share two primitives: the config dir root
// and a crash-safe atomic write. Those used to live in state.ts, which forced
// unrelated stores (docs.ts, chat.ts) to import the whole state domain model
// just to write a file safely. This module owns the generic seam so each store
// depends only on the filesystem helper, not on each other's domain types.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Root of all persisted companion state. Owner-only (mkdir mode 0o700 below) so
// nothing under it is world/group readable. Every store derives its path from
// here (state.json, chat/transcript.json, interests/<id>.md).
export const CONFIG_DIR = path.join(os.homedir(), ".config", "scout");

// The real user's state dir, from the password database so a faked HOME in a
// test cannot hide it.
const REAL_CONFIG_DIR = path.join(os.userInfo().homedir, ".config", "scout");

// Fails closed: under a test runner (NODE_TEST_CONTEXT), refuse any write,
// rename or delete inside the real ~/.config/scout. A test that forgets to
// pass a temp path then fails instead of editing the user's live state.
export function assertNotRealStateUnderTest(file: string): void {
  if (!process.env.NODE_TEST_CONTEXT) return;
  const rel = path.relative(REAL_CONFIG_DIR, path.resolve(file));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(
      `Refusing to touch ${file} from a test: it is inside the real ${REAL_CONFIG_DIR}. Pass a temp path.`,
    );
  }
}

// Atomic write: serialize to a sibling temp file, fsync it, then rename over
// the target. rename(2) is atomic on POSIX, so a crash mid-write can never
// leave a torn or truncated file — a reader that catches the parse error and
// returns a default would otherwise silently wipe whatever the file held. The
// fsync before the rename matters for POWER LOSS: without it the
// kernel may commit the rename to disk before the temp file's data blocks,
// and a badly-timed cut leaves the target pointing at an empty/partial file —
// exactly the torn state the rename was supposed to prevent. (On macOS
// fsync(2) flushes to the drive, not through its cache — F_FULLFSYNC would,
// but Node doesn't expose it; this is the standard durability/latency
// trade-off.) The temp file is uniquely named so concurrent savers can't
// clobber each other's in-flight temp; last rename wins, matching the
// existing last-writer contract. Shared so every persistence path
// (state.json, chat transcript, intent docs) gets the same crash-safety
// instead of re-deriving it per call site.
export async function atomicWriteFile(
  file: string,
  data: string,
  mode = 0o600,
): Promise<void> {
  assertNotRealStateUnderTest(file);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(tmp, "w", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
    await fsyncDir(dir);
  } catch (err) {
    // Best-effort cleanup so a failed write doesn't leave an orphan temp behind.
    // A failed cleanup must not mask the original write error, but a silent
    // swallow lets uniquely-named `.tmp` orphans accumulate in the config dir
    // (every failed save adds one) with zero signal. Log at warn so the leak is
    // observable; still re-throw the original write error below. Mirrors the
    // ephemeral-dir cleanup treatment in runner.ts.
    await fs.rm(tmp, { force: true }).catch((rmErr) => {
      console.warn(`[persistence] temp cleanup failed for ${tmp}:`, rmErr);
    });
    throw err;
  }
}

// Persist the rename itself: fsync the parent directory so the new directory
// entry survives power loss, not just the file's data blocks. Must never
// reject — by the time it runs the rename has succeeded, so the write is
// complete under the old (pre-fsync) contract; opening a directory for fsync
// is also unsupported on some platforms (notably Windows), where failing the
// whole save over a durability *narrowing* would be a regression. Warn so a
// persistent inability to fsync is still observable.
async function fsyncDir(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (err) {
    console.warn(`[persistence] directory fsync failed for ${dir}:`, err);
  } finally {
    await handle?.close().catch(() => {});
  }
}

// Read a JSON file through `parse`. Resolves undefined when the file is
// missing. When the bytes won't parse (or `parse` throws), the file is first
// renamed to `<file>.corrupt-<ms>.bak`, so the next write starts fresh without
// destroying what it held, then undefined. Any other read error rejects: the
// file is still there, and a caller that went on with nothing would overwrite
// it.
export async function readJsonFile<T>(
  file: string,
  parse: (value: unknown) => T,
): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return parse(JSON.parse(raw));
  } catch {
    const backup = `${file}.corrupt-${Date.now()}.bak`;
    try {
      assertNotRealStateUnderTest(file);
      await fs.rename(file, backup);
      console.error(`[scout] ${file} was corrupt; preserved at ${backup}`);
    } catch (err) {
      console.error(
        `[scout] ${file} was corrupt and could not be moved aside:`,
        err,
      );
    }
    return undefined;
  }
}
