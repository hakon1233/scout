// Generic filesystem persistence seam for the loopback companion (CAR-244).
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

// Atomic write: serialize to a sibling temp file, then rename over the target.
// rename(2) is atomic on POSIX, so a crash/power-loss mid-write can never leave
// a torn or truncated file — a reader that catches the parse error and returns
// a default would otherwise silently wipe whatever the file held. The temp file
// is uniquely named so concurrent savers can't clobber each other's in-flight
// temp; last rename wins, matching the existing last-writer contract. Shared so
// every persistence path (state.json, chat transcript, intent docs) gets the same
// crash-safety instead of re-deriving it per call site.
export async function atomicWriteFile(
  file: string,
  data: string,
  mode = 0o600,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode });
    await fs.rename(tmp, file);
  } catch (err) {
    // Best-effort cleanup so a failed write doesn't leave an orphan temp behind.
    // A failed cleanup must not mask the original write error, but a silent
    // swallow lets uniquely-named `.tmp` orphans accumulate in the config dir
    // (every failed save adds one) with zero signal. Log at warn so the leak is
    // observable; still re-throw the original write error below. Mirrors the
    // ephemeral-dir cleanup treatment in runner.ts (CAR-225).
    await fs.rm(tmp, { force: true }).catch((rmErr) => {
      console.warn(`[persistence] temp cleanup failed for ${tmp}:`, rmErr);
    });
    throw err;
  }
}
