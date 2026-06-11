// Bake build provenance into dist/build-info.json (PER-239).
//
// Runs as the last step of `pnpm --filter @scout/agent build` (after tsc), so
// every built companion carries the exact git SHA it was compiled from. The
// server surfaces it via GET /v0/version for exact-SHA QA gating.
//
// Best-effort by design: a build outside a git checkout (e.g. from a packed
// tarball) still succeeds — the fields just come out null and the endpoint
// degrades honestly instead of lying.

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: pkgDir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

let gitSha = git("rev-parse", "HEAD");
let gitShaShort = git("rev-parse", "--short", "HEAD");
// Mark dirty-worktree builds so QA never byte-matches a dirty build to the
// clean commit under test.
if (gitSha && git("status", "--porcelain")) {
  gitSha += "-dirty";
  gitShaShort = gitShaShort ? `${gitShaShort}-dirty` : null;
}

// Next.js BUILD_ID of the webroot bundled into this build. `pnpm build:agent`
// runs the webroot export (which leaves .next/BUILD_ID at the repo root)
// immediately before this build, so when present it identifies the served UI.
let nextBuildId = null;
try {
  nextBuildId = (
    await fs.readFile(path.join(repoRoot, ".next", "BUILD_ID"), "utf8")
  ).trim();
} catch {
  // No webroot build — agent-only rebuild or tarball context. Stay null.
}

const info = {
  git_sha: gitSha,
  git_sha_short: gitShaShort,
  next_build_id: nextBuildId,
  built_at: new Date().toISOString(),
};

const outFile = path.join(pkgDir, "dist", "build-info.json");
await fs.writeFile(outFile, JSON.stringify(info, null, 2) + "\n");
console.log(`[build-info] wrote ${outFile}: ${JSON.stringify(info)}`);
