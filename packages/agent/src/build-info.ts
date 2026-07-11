// Build provenance for exact-SHA QA gating (PER-239).
//
// `scripts/write-build-info.mjs` runs as part of the agent build (after tsc)
// and writes `dist/build-info.json` capturing the git SHA the build was made
// from, the Next.js BUILD_ID of the bundled webroot, and the build timestamp.
// The server exposes it via GET /v0/version (and folds git_sha into /healthz)
// so a QA gate can byte-verify "the served bundle IS commit X" instead of
// inferring deployment from code fingerprints.
//
// The compiled module lives at dist/build-info.js, so the JSON sits beside it
// (`./build-info.json`). When the file is absent — e.g. running from source
// via tsx, or a tarball built before this existed — every field degrades to
// null rather than failing the endpoint.

import { promises as fs, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The agent package version served by /healthz, /v0/version and /v0/config.
// Lives beside the git provenance because it answers the same question ("what
// exactly is running?"); moved here from server.ts in the PER-274 split so
// route modules don't have to import the router for a constant.
// Derived from package.json (not hand-duplicated) so a version bump can't
// drift from the served /v0/version response — the packed tarball is named
// after this same field, and a stale hardcode here used to silently 404 the
// onboarding tarball URL on the Connect page (PER-275).
const pkgJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
  version: string;
};
export const PKG_VERSION = pkgJson.version;

export type BuildInfo = {
  // Full 40-char git SHA of HEAD at build time; "-dirty" suffixed when the
  // worktree had uncommitted changes (so QA never mistakes a dirty build for
  // the clean commit under test). Null when built outside a git checkout.
  git_sha: string | null;
  git_sha_short: string | null;
  // Next.js BUILD_ID of the static webroot bundled into this build, when the
  // webroot build ran first (pnpm build:agent does). Null otherwise.
  next_build_id: string | null;
  built_at: string | null;
};

const EMPTY: BuildInfo = {
  git_sha: null,
  git_sha_short: null,
  next_build_id: null,
  built_at: null,
};

export const DEFAULT_BUILD_INFO_FILE = fileURLToPath(
  new URL("./build-info.json", import.meta.url),
);

// Read once, then serve from memory: the JSON is baked at build time and can
// only change across a rebuild+restart, so per-request rereads buy nothing.
const cache = new Map<string, Promise<BuildInfo>>();

export function readBuildInfo(
  file = DEFAULT_BUILD_INFO_FILE,
): Promise<BuildInfo> {
  let p = cache.get(file);
  if (!p) {
    p = fs
      .readFile(file, "utf8")
      .then((raw) => {
        const parsed = JSON.parse(raw) as Partial<BuildInfo>;
        return {
          git_sha: typeof parsed.git_sha === "string" ? parsed.git_sha : null,
          git_sha_short:
            typeof parsed.git_sha_short === "string"
              ? parsed.git_sha_short
              : null,
          next_build_id:
            typeof parsed.next_build_id === "string"
              ? parsed.next_build_id
              : null,
          built_at:
            typeof parsed.built_at === "string" ? parsed.built_at : null,
        };
      })
      // .catch (not a then-reject handler) so a malformed/truncated
      // build-info.json — JSON.parse throwing — degrades to EMPTY too, not just
      // a missing-file read rejection. Keeps the "never fail the endpoint"
      // contract above: /v0/version and /healthz answer 200 with null
      // provenance instead of 500ing on a corrupt build artifact.
      .catch(() => EMPTY);
    cache.set(file, p);
  }
  return p;
}
