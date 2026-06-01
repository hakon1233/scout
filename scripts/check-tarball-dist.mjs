#!/usr/bin/env node
// PER-120 stale-artifact guard (PER-111 lesson: "done in code ≠ shipped in the
// tarball"). After `pnpm run pack:agent` has freshly built packages/agent/dist
// AND packed it into public/agent/scout-agent-<v>.tgz, this asserts the dist
// that SHIPS inside the tarball is byte-identical to the dist on disk. Any drift
// (a stale tarball, a pack that didn't pick up the latest build, a partial
// rebuild) fails the deploy build instead of silently shipping the wrong code.
//
// Offline, no deps — uses the system `tar` to extract and node:crypto to hash.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentPkg = JSON.parse(
  readFileSync(join(repoRoot, "packages/agent/package.json"), "utf8"),
);
const version = agentPkg.version;
const tarballDir = join(repoRoot, "public/agent");
const tarballName = `scout-agent-${version}.tgz`;
const tarballPath = join(tarballDir, tarballName);
const builtDist = join(repoRoot, "packages/agent/dist");

function fail(msg) {
  console.error(`\n❌ tarball-vs-dist drift guard FAILED:\n${msg}\n`);
  process.exit(1);
}

// 1. The tarball must exist and be the only scout-agent tarball present, so we
//    can't accidentally validate against a stale leftover from a prior version.
let tarballs;
try {
  tarballs = readdirSync(tarballDir).filter(
    (f) => f.startsWith("scout-agent-") && f.endsWith(".tgz"),
  );
} catch {
  fail(`tarball directory not found: ${tarballDir} — did pack:agent run?`);
}
if (!tarballs.includes(tarballName)) {
  fail(
    `expected ${tarballName} (agent package version ${version}) in ${tarballDir}, found: ${
      tarballs.length ? tarballs.join(", ") : "(none)"
    }. Run \`pnpm run pack:agent\` first.`,
  );
}
if (tarballs.length > 1) {
  fail(
    `multiple tarballs present (${tarballs.join(
      ", ",
    )}); ambiguous which one ships. Clean public/agent/*.tgz before packing.`,
  );
}

// 2. Hash every file under packages/agent/dist on disk.
function hashTree(root) {
  const out = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile())
        out.set(
          relative(root, abs),
          createHash("sha256").update(readFileSync(abs)).digest("hex"),
        );
    }
  }
  walk(root);
  return out;
}

try {
  if (!statSync(builtDist).isDirectory()) throw new Error("not a dir");
} catch {
  fail(`built dist not found at ${builtDist} — did build:agent run?`);
}
const onDisk = hashTree(builtDist);
if (onDisk.size === 0) fail(`built dist at ${builtDist} is empty`);

// 3. Extract the tarball's package/dist to a temp dir and hash it the same way.
const tmp = mkdtempSync(join(tmpdir(), "scout-tarball-dist-"));
try {
  execFileSync("tar", ["-xzf", tarballPath, "-C", tmp, "package/dist"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const inTarball = hashTree(join(tmp, "package/dist"));
  if (inTarball.size === 0) fail(`tarball ${tarballName} has no package/dist`);

  // 4. Compare the two trees exactly.
  const problems = [];
  for (const [rel, hash] of onDisk) {
    if (!inTarball.has(rel)) problems.push(`missing from tarball: dist/${rel}`);
    else if (inTarball.get(rel) !== hash)
      problems.push(`content differs: dist/${rel}`);
  }
  for (const rel of inTarball.keys()) {
    if (!onDisk.has(rel)) problems.push(`extra in tarball (not in built dist): dist/${rel}`);
  }

  if (problems.length) {
    fail(
      `${problems.length} file(s) drifted between freshly-built packages/agent/dist and ${tarballName}:\n  - ${problems.join(
        "\n  - ",
      )}\nThe tarball that would ship does not match the source build.`,
    );
  }

  console.log(
    `✅ tarball-vs-dist guard OK: ${onDisk.size} dist file(s) in ${tarballName} are byte-identical to packages/agent/dist.`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
