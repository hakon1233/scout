import { execFile } from "node:child_process";
import { promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const FULL_SHA = /^[0-9a-f]{40}$/;

async function git(repoRoot, args) {
  const { stdout } = await execFileP("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

export async function assertDeployableCommit(repoRoot) {
  const dirty = await git(repoRoot, ["status", "--porcelain"]);
  if (dirty) {
    throw new Error("Refusing release from a dirty worktree.");
  }

  const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
  const shortSha = await git(repoRoot, ["rev-parse", "--short", "HEAD"]);
  const remoteLine = await git(repoRoot, [
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/main",
  ]);
  const remoteSha = remoteLine.split(/\s+/u)[0];
  if (!FULL_SHA.test(sha) || sha !== remoteSha) {
    throw new Error(
      `Refusing release: HEAD ${sha} is not pushed to origin/main ${remoteSha}.`,
    );
  }
  return { sha, shortSha };
}

export function defaultReleaseRoot(home = os.homedir()) {
  return path.join(home, "Library", "Application Support", "Scout", "agent");
}

function canonicalFuturePath(value) {
  let cursor = path.resolve(value);
  const missing = [];
  for (;;) {
    try {
      return path.join(realpathSync(cursor), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function assertExternalReleaseRoot(repoRoot, releaseRoot) {
  const repo = canonicalFuturePath(repoRoot);
  const releases = canonicalFuturePath(releaseRoot);
  const relative = path.relative(repo, releases);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  ) {
    throw new Error("Release root must be outside the source workspace.");
  }
  const paperclipWorkspace = `${path.sep}.paperclip${path.sep}instances${path.sep}`;
  if (
    releases.includes(paperclipWorkspace) &&
    releases.includes(`${path.sep}workspaces${path.sep}`)
  ) {
    throw new Error("Release root must not be inside a Paperclip workspace.");
  }
}

async function fetchWithin(
  fetchImpl,
  url,
  timeoutMs,
  consume = async (response) => response,
) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal });
        return await consume(response);
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function assertCompanionIdle(
  origin,
  fetchImpl = fetch,
  { allowUnknown = false, requestTimeoutMs = 1_000 } = {},
) {
  let response;
  let version;
  try {
    const result = await fetchWithin(
      fetchImpl,
      `${origin}/v0/version`,
      requestTimeoutMs,
      async (candidate) => ({
        response: candidate,
        version: candidate.ok ? await candidate.json() : null,
      }),
    );
    response = result.response;
    version = result.version;
  } catch (error) {
    if (allowUnknown) return { known: false, activityInFlight: null };
    throw new Error(`Cannot prove the companion is idle: ${String(error)}`);
  }
  if (!response.ok) {
    if (allowUnknown) return { known: false, activityInFlight: null };
    throw new Error(
      `Cannot prove the companion is idle: /v0/version returned ${response.status}.`,
    );
  }
  if (version.activity_in_flight === true) {
    throw new Error(
      "Refusing activation while companion activity is in flight.",
    );
  }
  if (version.activity_in_flight !== false) {
    if (allowUnknown) return { known: false, activityInFlight: null };
    throw new Error(
      "Cannot prove the companion is idle: activity_in_flight is unavailable.",
    );
  }
  return { known: true, activityInFlight: false };
}

// The busy-run drain is an invariant OF the activation path, not a courtesy the
// CLI performs on its behalf. It used to be a single `main()` call site, so any
// programmatic caller bypassed it in silence — QA's own PER-302 AC7 harness
// called migrateToReleases() directly, got no drain, and did not notice.
// Requiring `origin` rather than defaulting it is the point: a caller that has
// no way to prove the companion is idle is refused, not quietly waved through.
async function assertActivationPathIdle({
  origin,
  fetchImpl,
  allowUnknown,
  command,
}) {
  if (typeof origin !== "string" || origin === "") {
    throw new Error(
      `${command} requires an origin so it can prove the companion is idle ` +
        "before restarting it.",
    );
  }
  const idle = await assertCompanionIdle(origin, fetchImpl, { allowUnknown });
  if (!idle.known) {
    console.warn(
      "Activity state is unknown; proceeding only because SCOUT_ALLOW_UNKNOWN_ACTIVITY=1.",
    );
  }
  return idle;
}

export async function currentReleasePath(releaseRoot) {
  return await fs.realpath(path.join(releaseRoot, "current"));
}

export async function verifyRelease({
  origin,
  sha,
  attempts = 30,
  delayMs = 250,
  requestTimeoutMs = 1_000,
  deadlineMs = 15_000,
  fetchImpl = fetch,
}) {
  const deadline = Date.now() + deadlineMs;
  let lastError = new Error("Release did not become ready.");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error("Release readiness timed out.");
      const timeoutMs = Math.min(requestTimeoutMs, remainingMs);
      const { response: versionResponse, body: version } = await fetchWithin(
        fetchImpl,
        `${origin}/v0/version`,
        timeoutMs,
        async (response) => ({
          response,
          body: response.ok ? await response.json() : null,
        }),
      );
      if (!versionResponse.ok) {
        throw new Error(`/v0/version returned ${versionResponse.status}`);
      }
      if (version.git_sha !== sha) {
        throw new Error(
          `/v0/version reported ${version.git_sha ?? "null"}, expected ${sha}`,
        );
      }
      if (typeof version.next_build_id !== "string" || !version.next_build_id) {
        throw new Error("/v0/version did not report a UI build ID");
      }

      const appResponse = await fetchWithin(
        fetchImpl,
        `${origin}/app/`,
        timeoutMs,
        async (response) => {
          if (response.ok) await response.arrayBuffer();
          return response;
        },
      );
      if (!appResponse.ok) {
        throw new Error(`/app/ returned ${appResponse.status}`);
      }
      const { response: uiProvenanceResponse, body: uiProvenance } =
        await fetchWithin(
          fetchImpl,
          `${origin}/scout-build.json`,
          timeoutMs,
          async (response) => ({
            response,
            body: response.ok ? await response.json() : null,
          }),
        );
      if (!uiProvenanceResponse.ok) {
        throw new Error(
          `/scout-build.json returned ${uiProvenanceResponse.status}`,
        );
      }
      const servedBuildId = uiProvenance.next_build_id;
      if (servedBuildId !== version.next_build_id) {
        throw new Error(
          `served UI build ${servedBuildId ?? "null"} does not match ` +
            `/v0/version ${version.next_build_id}`,
        );
      }
      return version;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt + 1 < attempts && Date.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(delayMs, deadline - Date.now())),
        );
      }
    }
  }
  throw lastError;
}

async function freezeTree(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await freezeTree(entryPath);
    } else if (!entry.isSymbolicLink()) {
      await fs.chmod(entryPath, 0o444);
    }
  }
  await fs.chmod(dir, 0o555);
}

async function thawTree(dir) {
  await fs.chmod(dir, 0o755);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await thawTree(entryPath);
    else await fs.chmod(entryPath, 0o644);
  }
}

async function assertNoSymlinks(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Release artifact must not contain symlinks: ${entryPath}`,
      );
    }
    if (entry.isDirectory()) await assertNoSymlinks(entryPath);
  }
}

async function readBundledBuildInfo(releasePath) {
  const buildInfo = JSON.parse(
    await fs.readFile(
      path.join(releasePath, "dist", "build-info.json"),
      "utf8",
    ),
  );
  if (typeof buildInfo.next_build_id !== "string" || !buildInfo.next_build_id) {
    throw new Error("Packed release has no UI build ID.");
  }
  const uiProvenance = JSON.parse(
    await fs.readFile(
      path.join(releasePath, "webroot", "scout-build.json"),
      "utf8",
    ),
  );
  const bundledBuildId = uiProvenance.next_build_id;
  if (bundledBuildId !== buildInfo.next_build_id) {
    throw new Error(
      `Packed UI build ${bundledBuildId ?? "null"} does not match manifest ` +
        `${buildInfo.next_build_id}.`,
    );
  }
  return buildInfo;
}

// PER-299 exists because "what commit is live" had two answers. Writing the
// expected SHA into the artifact's provenance record and reading it back does
// not reduce that to one answer — it produces one answer that agrees with
// itself. The packed artifact's own git_sha is the observation; `sha` is only
// what we asked for. Compare them; never copy one onto the other.
//
// The absent and dirty cases are refusals rather than values to normalise:
// write-build-info.mjs emits the `-dirty` suffix precisely so a dirty build
// can never be byte-matched to the clean commit under test, and returns null
// when git could not be read at all. Both are the signals that would have
// caught this defect, so both must be loud.
function assertObservedSha(buildInfo, expectedSha, expectedShortSha) {
  const observed = buildInfo.git_sha;

  if (typeof observed !== "string" || observed === "") {
    throw new Error(
      `Packed release records no git_sha (${JSON.stringify(observed) ?? "undefined"}). ` +
        "Its provenance cannot be established, so it cannot be released.",
    );
  }
  if (observed.endsWith("-dirty")) {
    throw new Error(
      `Packed release was built from a dirty worktree (${observed}). ` +
        "Release only from a clean checkout — the -dirty marker exists so a " +
        "dirty build is never matched to the clean commit under test.",
    );
  }
  if (observed !== expectedSha) {
    throw new Error(
      `Packed release reports git_sha ${observed}, expected ${expectedSha}. ` +
        "The artifact was not built from the commit being released.",
    );
  }
  if (expectedShortSha && buildInfo.git_sha_short !== expectedShortSha) {
    throw new Error(
      `Packed release reports git_sha_short ${buildInfo.git_sha_short ?? "null"}, ` +
        `expected ${expectedShortSha}.`,
    );
  }

  return observed;
}

async function validateStagedRelease(releaseRoot, sha) {
  const releases = path.join(releaseRoot, "releases");
  const target = path.join(releases, sha);
  const targetStat = await fs.lstat(target).catch(() => null);
  if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`Release is not a real staged directory: ${target}`);
  }
  const releasesReal = await fs.realpath(releases);
  const targetReal = await fs.realpath(target);
  if (path.dirname(targetReal) !== releasesReal) {
    throw new Error(
      `Release escapes the immutable releases directory: ${target}`,
    );
  }
  await assertNoSymlinks(target);
  const release = JSON.parse(
    await fs.readFile(path.join(target, "release.json"), "utf8"),
  );
  const buildInfo = await readBundledBuildInfo(target);
  // Re-observes the artifact rather than trusting release.json, so a release
  // staged by an older (or tampered-with) writer is still held to the bar.
  assertObservedSha(buildInfo, sha, release.git_sha_short ?? undefined);
  if (
    release.sha !== sha ||
    release.next_build_id !== buildInfo.next_build_id
  ) {
    throw new Error(`Existing release ${target} has invalid provenance.`);
  }
  await freezeTree(target);
  return target;
}

export async function stagePackedRelease({
  tarball,
  releaseRoot,
  sha,
  shortSha,
}) {
  if (!FULL_SHA.test(sha)) throw new Error(`Invalid release SHA: ${sha}`);
  const releases = path.join(releaseRoot, "releases");
  const target = path.join(releases, sha);
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) {
    return await validateStagedRelease(releaseRoot, sha);
  }

  await fs.mkdir(releases, { recursive: true, mode: 0o755 });
  const staging = path.join(
    releases,
    `.${sha}.staging-${process.pid}-${Date.now()}`,
  );
  await fs.mkdir(staging);
  let promoted = false;
  try {
    await execFileP(
      "tar",
      ["-xzf", tarball, "-C", staging, "--strip-components=1"],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    await assertNoSymlinks(staging);
    const buildInfo = await readBundledBuildInfo(staging);
    const observedSha = assertObservedSha(buildInfo, sha, shortSha);
    // dist/build-info.json is left exactly as it was packed. Rewriting it here
    // is what turned the live SHA into an assertion instead of an observation.
    await fs.writeFile(
      path.join(staging, "release.json"),
      `${JSON.stringify(
        {
          // Derived from the artifact's own provenance, not from the caller's
          // argument, so validateStagedRelease and verifyRelease compare two
          // independently-produced values rather than a value to a copy of it.
          sha: observedSha,
          git_sha_short: buildInfo.git_sha_short ?? null,
          next_build_id: buildInfo.next_build_id,
          built_at: buildInfo.built_at ?? null,
        },
        null,
        2,
      )}\n`,
    );
    await freezeTree(staging);
    await fs.chmod(staging, 0o755);
    await fs.rename(staging, target);
    promoted = true;
    await fs.chmod(target, 0o555);
    return target;
  } catch (error) {
    await thawTree(staging).catch(() => undefined);
    await fs
      .rm(staging, { recursive: true, force: true })
      .catch(() => undefined);
    if (promoted) {
      await thawTree(target).catch(() => undefined);
      await fs
        .rm(target, { recursive: true, force: true })
        .catch(() => undefined);
    }
    throw error;
  }
}

async function packAgent(worktree) {
  const options = {
    cwd: worktree,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  };
  await execFileP("pnpm", ["install", "--frozen-lockfile"], options);
  await execFileP("pnpm", ["run", "pack:agent"], options);
  const packDir = path.join(worktree, "public", "agent");
  const tarballs = (await fs.readdir(packDir))
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (tarballs.length === 0) {
    throw new Error(`pack:agent produced no tarball in ${packDir}`);
  }
  return path.join(packDir, tarballs[tarballs.length - 1]);
}

export async function buildRelease({
  repoRoot,
  releaseRoot = defaultReleaseRoot(),
  pack = packAgent,
}) {
  assertExternalReleaseRoot(repoRoot, releaseRoot);
  const { sha, shortSha } = await assertDeployableCommit(repoRoot);
  const existing = path.join(releaseRoot, "releases", sha);
  if (await fs.lstat(existing).catch(() => null)) {
    return await validateStagedRelease(releaseRoot, sha);
  }

  const buildRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-release-build-"),
  );
  const worktree = path.join(buildRoot, "source");
  let added = false;
  try {
    await execFileP("git", ["worktree", "add", "--detach", worktree, sha], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    added = true;
    const tarball = await pack(worktree);
    return await stagePackedRelease({
      tarball,
      releaseRoot,
      sha,
      shortSha,
    });
  } finally {
    try {
      if (added) {
        await execFileP("git", ["worktree", "remove", "--force", worktree], {
          cwd: repoRoot,
        });
      }
    } finally {
      await fs.rm(buildRoot, { recursive: true, force: true });
    }
  }
}

export async function restartLaunchAgent({
  releaseRoot,
  home = os.homedir(),
  port,
}) {
  const currentDist = path.join(releaseRoot, "current", "dist");
  const serviceUrl = pathToFileURL(path.join(currentDist, "service.js"));
  serviceUrl.searchParams.set("activation", `${Date.now()}-${Math.random()}`);
  const { installService } = await import(serviceUrl.href);
  const result = await installService({
    home,
    port,
    scriptPath: path.join(currentDist, "cli.js"),
  });
  if (!result.bootstrapped) {
    throw new Error(result.note || "LaunchAgent did not bootstrap.");
  }
  return result;
}

// The first migration: launchd moves off the development workspace and onto
// the stable `current` path. It happens exactly once, it is the only step in
// this system with no immutable predecessor to fall back to, and it runs on
// the founder's only instance — so unlike a routine A→B activation it must
// carry its own reverse.
//
// Deliberately loads the service module from the STAGED RELEASE rather than
// from `current`. restartLaunchAgent imports `current/dist/service.js`, which
// pre-migration does not exist, so it structurally cannot create the first
// `current`.
export async function migrateToReleases({
  releaseRoot,
  sha,
  origin,
  fetchImpl = fetch,
  home = os.homedir(),
  verify,
  now = () => Date.now(),
  // Test seam only: keeps `launchctl bootout ing.scout.agent` away from the
  // founder's running job. Production leaves it unset.
  bootstrap,
}) {
  if (!FULL_SHA.test(sha)) throw new Error(`Invalid release SHA: ${sha}`);
  // allowUnknown is hardcoded false and takes no caller input. The hatch may
  // soften a steady-state deploy, but this is the one-shot transition that
  // reaches the founder: it boots launchd out and back in, so an in-flight
  // research run or chat turn dies with it. "We could not reach the companion"
  // is not evidence that nothing was running. Drain BEFORE taking the
  // activation lock, so the lock is never held across network I/O.
  await assertActivationPathIdle({
    origin,
    fetchImpl,
    allowUnknown: false,
    command: "migrate",
  });
  const unlock = await acquireActivationLock(releaseRoot);
  try {
    const target = await validateStagedRelease(releaseRoot, sha);

    let existingCurrent = null;
    try {
      existingCurrent = await currentReleasePath(releaseRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existingCurrent) {
      throw new Error(
        `Already migrated: current -> ${existingCurrent}. ` +
          "Use `deploy` for subsequent releases; migrate is first-time only.",
      );
    }

    const serviceUrl = pathToFileURL(path.join(target, "dist", "service.js"));
    serviceUrl.searchParams.set("migration", `${now()}-${process.pid}`);
    const {
      readExistingService,
      installService,
      restoreServicePlist,
      droppedEnvKeys,
      preMigrationPlistPath,
    } = await import(serviceUrl.href);

    const existing = await readExistingService(home);
    if (!existing) {
      throw new Error(
        "No LaunchAgent plist is installed, so there is nothing to migrate. " +
          "Use `scout-agent install-service --script-path <releaseRoot>/current/dist/cli.js`.",
      );
    }

    // Carry EVERY variable forward rather than an allowlist of the ones we
    // happened to think of. The plist is regenerated from scratch, so an
    // unreproduced var is dropped in silence: the live job carries
    // SCOUT_SESSION_TIMEOUT_MS=900000, and losing it would drop research and
    // per-chat-turn timeouts to the ~4-minute default with no error.
    const extraEnv = {};
    for (const key of droppedEnvKeys(existing.environment)) {
      extraEnv[key] = existing.environment[key];
    }

    // Preserve the legacy bytes BEFORE anything is written, and never
    // overwrite them: this file is the only record of the pre-release plist.
    const preMigration = preMigrationPlistPath(home);
    const alreadyPreserved = await fs
      .readFile(preMigration, "utf8")
      .catch(() => null);
    if (alreadyPreserved === null) {
      await fs.writeFile(preMigration, existing.xml, { mode: 0o644 });
    }
    const legacyXml = alreadyPreserved ?? existing.xml;

    let pointed = false;
    try {
      await pointCurrent(releaseRoot, target);
      pointed = true;
      const result = await installService({
        home,
        // Reproduce the port the job already had. The live plist has none, and
        // defaulting here is how a stray SCOUT_AGENT_PORT would silently move
        // the founder off 47821.
        port: existing.port,
        scriptPath: path.join(releaseRoot, "current", "dist", "cli.js"),
        extraEnv,
        bootstrap,
      });
      if (!result.bootstrapped) {
        throw new Error(result.note || "LaunchAgent did not bootstrap.");
      }
      if (verify) await verify({ sha });
      return {
        migrated: sha,
        from: existing.programArguments,
        preservedPlist: preMigration,
        carriedEnv: Object.keys(extraEnv).sort(),
        port: existing.port ?? null,
      };
    } catch (error) {
      const failures = [error instanceof Error ? error.message : String(error)];
      try {
        await restoreServicePlist({ xml: legacyXml, home, bootstrap });
      } catch (restoreError) {
        failures.push(
          `restoring the legacy plist ALSO failed: ${
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError)
          }. Reinstall by hand from ${preMigration}.`,
        );
      }
      if (pointed) {
        await fs
          .rm(path.join(releaseRoot, "current"), { force: true })
          .catch(() => undefined);
      }
      throw new Error(`Migration rolled back: ${failures.join(" — ")}`);
    }
  } finally {
    await unlock();
  }
}

async function pointCurrent(releaseRoot, releasePath) {
  const next = path.join(releaseRoot, `.current-${process.pid}-${Date.now()}`);
  await fs.symlink(releasePath, next);
  await fs.rename(next, path.join(releaseRoot, "current"));
}

function releaseSha(releasePath) {
  return releasePath ? path.basename(releasePath) : null;
}

async function acquireActivationLock(releaseRoot) {
  await fs.mkdir(releaseRoot, { recursive: true });
  const lockPath = path.join(releaseRoot, "activation.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      return async () => {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = Number.parseInt(
        await fs.readFile(lockPath, "utf8").catch(() => ""),
        10,
      );
      let ownerAlive = Number.isInteger(owner) && owner > 0;
      if (ownerAlive) {
        try {
          process.kill(owner, 0);
        } catch (ownerError) {
          if (ownerError?.code === "ESRCH") ownerAlive = false;
          else throw ownerError;
        }
      }
      if (ownerAlive) {
        throw new Error(`Another activation is running (pid ${owner}).`);
      }
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error("Could not acquire the activation lock.");
}

export async function activateRelease({
  releaseRoot,
  sha,
  restart,
  verify,
  origin,
  fetchImpl = fetch,
  // Steady-state A→B activation is where SCOUT_ALLOW_UNKNOWN_ACTIVITY is
  // allowed to open. It defaults closed so a caller that omits it inherits the
  // strict behavior; only main() opts in, and only from the env var.
  allowUnknown = false,
}) {
  if (!FULL_SHA.test(sha)) throw new Error(`Invalid release SHA: ${sha}`);
  await assertActivationPathIdle({
    origin,
    fetchImpl,
    allowUnknown,
    command: "activate",
  });
  const unlock = await acquireActivationLock(releaseRoot);
  try {
    const target = await validateStagedRelease(releaseRoot, sha);
    let previous = null;
    try {
      previous = await currentReleasePath(releaseRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!previous) {
      throw new Error(
        "First migration from the legacy workspace service requires separate " +
          "approval. Use `release-agent migrate`, which preserves the legacy " +
          "plist and restores it if the migrated service fails to come up.",
      );
    }
    const previousSha = releaseSha(previous);
    if (!FULL_SHA.test(previousSha)) {
      throw new Error(`Current release has an invalid SHA path: ${previous}`);
    }
    const validatedPrevious = await validateStagedRelease(
      releaseRoot,
      previousSha,
    );
    if ((await fs.realpath(validatedPrevious)) !== previous) {
      throw new Error(
        `Current release escapes the immutable release root: ${previous}`,
      );
    }

    await pointCurrent(releaseRoot, target);
    try {
      await restart(target);
      await verify({ sha, releasePath: target });
    } catch (activationError) {
      try {
        await pointCurrent(releaseRoot, previous);
        await restart(previous);
        await verify({ sha: previousSha, releasePath: previous });
      } catch (rollbackError) {
        throw new Error(
          `Activation failed (${String(activationError)}); rollback also failed (${String(rollbackError)}). Current was repointed to ${previous}.`,
        );
      }
      throw new Error(
        `Activation failed and rolled back: ${String(activationError)}`,
      );
    }

    return {
      activated: sha,
      previous: previousSha,
      rolledBack: false,
    };
  } finally {
    await unlock();
  }
}

function usage() {
  return `Scout immutable local releases

Usage:
  node scripts/release-agent.mjs build
  node scripts/release-agent.mjs activate
  node scripts/release-agent.mjs deploy

deploy is the canonical command: build a clean origin/main release, atomically
point current at it, restart launchd once, and verify backend + UI provenance.

migrate is the one-shot first transition: it moves launchd off the development
workspace onto the stable current path. It preserves the legacy plist, carries
its environment and port forward verbatim, and restores it if the migrated
service fails to verify. Use it once; use deploy from then on.

Every activation command drains first: it refuses to restart the companion
while a research run or chat turn is in flight.

Environment:
  SCOUT_AGENT_PORT    Companion port (default 47821)
  SCOUT_ALLOW_UNKNOWN_ACTIVITY=1  Proceed when activity state cannot be read.
                      Applies to activate/deploy ONLY. migrate ignores it: the
                      first transition reaches the founder and always refuses
                      unless it can prove the companion is idle.
`;
}

async function main() {
  const command = process.argv[2] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (!["build", "activate", "deploy", "migrate"].includes(command)) {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  // Production commands have one canonical root. Tests exercise the exported
  // functions with injected temporary roots; the CLI cannot install under a
  // workspace or /tmp by configuration accident.
  const releaseRoot = defaultReleaseRoot();
  assertExternalReleaseRoot(repoRoot, releaseRoot);
  const configuredPort = Number(process.env.SCOUT_AGENT_PORT);
  const port =
    Number.isInteger(configuredPort) &&
    configuredPort > 0 &&
    configuredPort <= 65535
      ? configuredPort
      : 47821;
  const origin = `http://127.0.0.1:${port}`;

  let releasePath;
  if (command === "build" || command === "deploy") {
    releasePath = await buildRelease({ repoRoot, releaseRoot });
    console.log(`Staged immutable release ${releasePath}`);
  }
  if (command === "build") return;

  const { sha } = await assertDeployableCommit(repoRoot);
  releasePath ??= path.join(releaseRoot, "releases", sha);

  // No drain call site here. Both activation entry points run it themselves,
  // so the CLI and any programmatic caller are held to the same bar.
  if (command === "migrate") {
    const migration = await migrateToReleases({
      releaseRoot,
      sha,
      origin,
      verify: async ({ sha: expectedSha }) =>
        await verifyRelease({ origin, sha: expectedSha }),
    });
    console.log(
      `Migrated launchd to ${migration.migrated}\n` +
        `  was: ${migration.from.join(" ")}\n` +
        `  legacy plist preserved at: ${migration.preservedPlist}\n` +
        `  env carried forward: ${migration.carriedEnv.join(", ") || "(none)"}\n` +
        `  port: ${migration.port ?? "(unset, as before)"}`,
    );
    return;
  }

  const result = await activateRelease({
    releaseRoot,
    sha,
    origin,
    allowUnknown: process.env.SCOUT_ALLOW_UNKNOWN_ACTIVITY === "1",
    restart: async () => await restartLaunchAgent({ releaseRoot, port }),
    verify: async ({ sha: expectedSha }) =>
      await verifyRelease({ origin, sha: expectedSha }),
  });
  console.log(
    `Activated ${result.activated}` +
      (result.previous ? ` (previous ${result.previous})` : ""),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
