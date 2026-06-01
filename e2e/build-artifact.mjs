// Build the SHIPPED @scout/agent artifact the way a user would receive it, then
// unpack it into e2e/.artifact/package/ so the E2E runs the *packed tarball* —
// not packages/agent/src/. This is the PER-111 lesson made executable: "done in
// code ≠ shipped in the tarball." If a file the companion needs at runtime
// (dist/*, webroot/*) is missing from package.json `files`, this step still
// succeeds but the companion fails to boot/serve — and the E2E catches it.
//
// Steps:
//   1. `pnpm run pack:agent` — builds the webroot static export, compiles the
//      agent to dist/, and `npm pack`s a versioned .tgz into public/agent/.
//   2. Extract the newest .tgz into e2e/.artifact/package/ (npm tarballs always
//      nest everything under a top-level `package/` dir).
//
// @scout/agent has zero runtime dependencies (see packages/agent/package.json),
// so the unpacked tree is directly runnable with `node package/dist/cli.js` —
// no install step. Returns the absolute path to the packed CLI entrypoint.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(E2E_DIR, "..");
const PACK_OUT = path.join(REPO_ROOT, "public", "agent");
const ARTIFACT_DIR = path.join(E2E_DIR, ".artifact");

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

export function buildArtifact() {
  // 1. Pack the shipped tarball (build:agent-webroot + build:agent + npm pack).
  run("pnpm", ["run", "pack:agent"], REPO_ROOT);

  // 2. Find the freshest @scout/agent-*.tgz produced by the pack step.
  const tarballs = readdirSync(PACK_OUT)
    .filter((f) => f.startsWith("scout-agent-") && f.endsWith(".tgz"))
    .map((f) => path.join(PACK_OUT, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (tarballs.length === 0) {
    throw new Error(`no @scout/agent tarball found in ${PACK_OUT} after pack:agent`);
  }
  const tarball = tarballs[0];

  // 3. Extract into a clean e2e/.artifact/ (tar nests under package/).
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", ARTIFACT_DIR], REPO_ROOT);

  const pkgDir = path.join(ARTIFACT_DIR, "package");
  const cliEntry = path.join(pkgDir, "dist", "cli.js");
  const webroot = path.join(pkgDir, "webroot", "app", "index.html");
  for (const required of [cliEntry, webroot]) {
    if (!existsSync(required)) {
      throw new Error(
        `packed artifact is missing ${path.relative(pkgDir, required)} — ` +
          `check the \`files\` list in packages/agent/package.json (PER-111)`,
      );
    }
  }

  return { pkgDir, cliEntry, tarball };
}

// Allow running standalone for debugging: `node e2e/build-artifact.mjs`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { tarball, cliEntry } = buildArtifact();
  console.log(`packed:   ${tarball}`);
  console.log(`cli:      ${cliEntry}`);
}
