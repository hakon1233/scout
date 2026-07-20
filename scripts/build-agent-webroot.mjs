// Build the Scout web UI as a static export for the companion to serve from
// its own loopback origin (http://127.0.0.1:47821/), and stage it into
// `packages/agent/webroot/`.
//
// Why a dedicated build: the GitHub Pages deploy builds with basePath=/scout
// (it lives at hakon1233.github.io/scout). The companion serves the UI at the
// ROOT of its origin, so this build forces an EMPTY basePath — assets resolve
// to `/_next/...`, routes to `/`, `/app/`, `/app/connect/`. A localhost page
// calling the localhost API is same-origin, so Chrome's Local Network Access
// gate never engages → no "Allow local network" prompt. That is the whole
// point of PER-110.
//
// Run from the repo root: `node scripts/build-agent-webroot.mjs`.

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeToBuild } from "./live-build-guard.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outDir = path.join(repoRoot, "out");
const webroot = path.join(repoRoot, "packages", "agent", "webroot");

assertSafeToBuild({ repoRoot });

// Force empty basePath: next.config.ts derives basePath from GITHUB_REPOSITORY,
// so we must run the export with it unset.
// NODE_ENV=production is required: the export prerender otherwise hits a React
// "Cannot read properties of null (reading 'useContext')" crash on the static
// error pages under Next 16.
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "production",
};
delete env.GITHUB_REPOSITORY;

console.log("[webroot] next build (empty basePath, static export)...");
execFileSync("pnpm", ["exec", "next", "build"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

console.log(`[webroot] syncing ${outDir} -> ${webroot}`);
await fs.rm(webroot, { recursive: true, force: true });
await fs.cp(outDir, webroot, { recursive: true });

// Stable, machine-readable UI provenance. Next's generated HTML starts with
// `/_next/static/media` and `/_next/static/chunks`; neither segment is the
// BUILD_ID. Keep verification independent of Next's serialized-page format.
const nextBuildId = (
  await fs.readFile(path.join(repoRoot, ".next", "BUILD_ID"), "utf8")
).trim();
if (!nextBuildId) throw new Error("[webroot] Next BUILD_ID is empty");
await fs.writeFile(
  path.join(webroot, "scout-build.json"),
  `${JSON.stringify({ next_build_id: nextBuildId })}\n`,
);

// Sanity check: the export must be root-relative, not /scout-prefixed.
const indexHtml = await fs.readFile(path.join(webroot, "index.html"), "utf8");
if (indexHtml.includes("/scout/_next/")) {
  throw new Error(
    "[webroot] export contains /scout/ basePath — GITHUB_REPOSITORY leaked into the build",
  );
}
if (!indexHtml.includes("/_next/")) {
  throw new Error("[webroot] export is missing /_next/ asset references");
}

const appIndex = path.join(webroot, "app", "index.html");
await fs.access(appIndex); // throws if the /app/ route didn't export

console.log(
  "[webroot] OK — bundled static UI is root-relative and includes /app/.",
);
