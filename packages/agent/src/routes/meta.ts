// Unauthenticated liveness + build-provenance routes (PER-274 split).
// /healthz is dispatched directly by the router (it sits OUTSIDE the /v0
// origin-deny gate — liveness must answer no matter who asks); /v0/version is
// in the V0 dispatch table with auth "none".

import { PKG_VERSION, readBuildInfo } from "../build-info.js";
import { isChatInFlight } from "../chat.js";
import { json } from "../http-util.js";
import { isRunInFlight } from "../runner.js";
import { listCorruptStateBackups } from "../state.js";
import type { RequestContext, ServerContext } from "./types.js";

// git_sha folded in for QA convenience (PER-239); /v0/version is the
// full provenance contract.
export async function handleHealthz(
  { res, cors }: RequestContext,
  sc: ServerContext,
): Promise<void> {
  const build = await readBuildInfo(sc.buildInfoFile);
  // Corrupt-state recovery surfacing (PER-272): when loadState had to move a
  // corrupt state.json aside, the companion boots freshly unpaired and the
  // only signal was a console line nobody watches under launchd. Folding it
  // in here makes the recovery visible to anything that already checks
  // companion health (UI probe, QA, curl). Needs no auth: this endpoint is
  // loopback-only and the field discloses only that backups exist and when —
  // never their contents.
  const corruptBackups = await listCorruptStateBackups(sc.stateFile);
  json(
    res,
    200,
    {
      ok: true,
      version: PKG_VERSION,
      git_sha: build.git_sha,
      state_recovery:
        corruptBackups.length === 0
          ? null
          : {
              corrupt_backups: corruptBackups.length,
              latest: corruptBackups[corruptBackups.length - 1],
            },
    },
    cors,
  );
}

// Build provenance for exact-SHA QA gating (PER-239). Unauthenticated
// like /healthz: it discloses only which commit of an open repo this
// build came from — nothing user- or token-derived. QA byte-matches
// `git_sha` against the commit under test instead of inferring the
// deployment from served code fingerprints. Fields are null when the
// build predates this (no dist/build-info.json) — honest degradation,
// never a 500.
export async function handleVersion(
  { res, cors }: RequestContext,
  sc: ServerContext,
): Promise<void> {
  const build = await readBuildInfo(sc.buildInfoFile);
  const runInFlight = isRunInFlight();
  const chatInFlight = isChatInFlight();
  json(
    res,
    200,
    {
      ok: true,
      version: PKG_VERSION,
      git_sha: build.git_sha,
      git_sha_short: build.git_sha_short,
      next_build_id: build.next_build_id,
      built_at: build.built_at,
      // Read-only deploy-drain signal. Activation refuses a known-busy process
      // before asking launchd to restart it; no user or brief data is exposed.
      run_in_flight: runInFlight,
      chat_in_flight: chatInFlight,
      activity_in_flight: runInFlight || chatInFlight,
    },
    cors,
  );
}
