// PER-303 blockers 2/3/4: the launchd plist rewrite is the fragile half of the
// release system, and the legacy->current migration is the one activation with
// no immutable predecessor to fall back to.
//
// SAFETY: nothing here may reach the real launchd job. installService shells
// out to `launchctl bootout gui/<uid>/ing.scout.agent`, which would stop the
// founder's running companion. Every call below injects a `bootstrap` stub, and
// SCOUT_LAUNCH_AGENT_PLIST pins the plist under a temp dir so no test can write
// to ~/Library/LaunchAgents.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertStableScriptPath,
  buildLaunchAgentPlist,
  droppedEnvKeys,
  installService,
  isPlistStructurallyValid,
  isServiceInstalled,
  readExistingService,
  restoreServicePlist,
  backupPlistPath,
} from "../src/service.js";

const SHA = "a".repeat(40);

// A stand-in for the founder's real pre-release plist: launchd pointed straight
// at a development workspace, carrying SCOUT_SESSION_TIMEOUT_MS and NO --port.
function legacyPlist(opts: { scriptPath: string; home: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ing.scout.agent</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/node</string>
      <string>${opts.scriptPath}</string>
      <string>run</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${opts.home}</string>
      <key>PATH</key>
      <string>/usr/bin:/bin</string>
      <key>SCOUT_SESSION_TIMEOUT_MS</key>
      <string>900000</string>
    </dict>
  </dict>
</plist>
`;
}

async function pinnedHome(t: any): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "scout-service-"));
  const plist = path.join(home, "ing.scout.agent.plist");
  const previous = process.env.SCOUT_LAUNCH_AGENT_PLIST;
  process.env.SCOUT_LAUNCH_AGENT_PLIST = plist;
  t.after(async () => {
    if (previous === undefined) delete process.env.SCOUT_LAUNCH_AGENT_PLIST;
    else process.env.SCOUT_LAUNCH_AGENT_PLIST = previous;
    await fs.rm(home, { recursive: true, force: true });
  });
  return home;
}

const noopBootstrap = async () => ({ bootstrapped: true, note: "stubbed" });

// --- blocker 2: the install-service footgun ------------------------------

test("refuses to pin the plist inside an immutable release directory", () => {
  // This is exactly what realpath(process.argv[1]) yields once `current`
  // exists, because realpath dereferences the symlink.
  assert.throws(
    () =>
      assertStableScriptPath(
        `/Users/x/Library/Application Support/Scout/agent/releases/${SHA}/dist/cli.js`,
      ),
    /immutable release directory/,
  );
});

test("accepts the stable current path the release system installs", () => {
  assert.doesNotThrow(() =>
    assertStableScriptPath(
      "/Users/x/Library/Application Support/Scout/agent/current/dist/cli.js",
    ),
  );
  // A legacy workspace path is not what we want long-term, but refusing it
  // here would make the migration itself impossible.
  assert.doesNotThrow(() =>
    assertStableScriptPath("/Users/x/workspaces/scout-repo/dist/cli.js"),
  );
});

test("installService refuses a release-pinned scriptPath before writing anything", async (t) => {
  const home = await pinnedHome(t);
  if (process.platform !== "darwin") return;

  await assert.rejects(
    installService({
      home,
      scriptPath: `/tmp/agent/releases/${SHA}/dist/cli.js`,
      bootstrap: noopBootstrap,
    }),
    /immutable release directory/,
  );
  await assert.rejects(
    fs.stat(process.env.SCOUT_LAUNCH_AGENT_PLIST!),
    /ENOENT/,
    "a refused install must not have written a plist",
  );
});

// --- blocker 3: atomic, backed up, reversible, validated ------------------

test("isServiceInstalled rejects a truncated plist instead of reporting durable", async (t) => {
  const home = await pinnedHome(t);
  const plist = process.env.SCOUT_LAUNCH_AGENT_PLIST!;

  await fs.writeFile(plist, legacyPlist({ scriptPath: "/x/cli.js", home }));
  assert.equal(isServiceInstalled(home), true);

  // Exactly what a non-atomic write leaves behind if it dies partway: the file
  // exists, so the old existsSync check still reported reboot_durable:true
  // while launchd would fail to bootstrap it at next login.
  const truncated = legacyPlist({ scriptPath: "/x/cli.js", home }).slice(
    0,
    200,
  );
  await fs.writeFile(plist, truncated);
  assert.equal(isServiceInstalled(home), false);
  assert.equal(isPlistStructurallyValid(truncated), false);
});

test("installService preserves the prior plist before overwriting it", async (t) => {
  const home = await pinnedHome(t);
  if (process.platform !== "darwin") return;
  const plist = process.env.SCOUT_LAUNCH_AGENT_PLIST!;
  const legacy = legacyPlist({ scriptPath: "/legacy/workspace/cli.js", home });
  await fs.writeFile(plist, legacy);

  await installService({
    home,
    scriptPath: "/tmp/agent/current/dist/cli.js",
    bootstrap: noopBootstrap,
  });

  assert.equal(await fs.readFile(backupPlistPath(home), "utf8"), legacy);
  const written = await fs.readFile(plist, "utf8");
  assert.notEqual(written, legacy);
  assert.match(written, /current\/dist\/cli\.js/);
});

test("restoreServicePlist puts the original bytes back and refuses invalid ones", async (t) => {
  const home = await pinnedHome(t);
  const plist = process.env.SCOUT_LAUNCH_AGENT_PLIST!;
  const legacy = legacyPlist({ scriptPath: "/legacy/workspace/cli.js", home });
  await fs.writeFile(plist, '<?xml version="1.0"?><plist>replaced</plist>');

  await restoreServicePlist({ xml: legacy, home, bootstrap: noopBootstrap });
  assert.equal(await fs.readFile(plist, "utf8"), legacy);

  await assert.rejects(
    restoreServicePlist({ xml: "truncated", home, bootstrap: noopBootstrap }),
    /not structurally valid/,
  );
  assert.equal(
    await fs.readFile(plist, "utf8"),
    legacy,
    "a refused restore must not damage the installed plist",
  );
});

// --- blocker 4: env and port carried forward, never silently dropped ------

test("reads the environment and absent port out of the legacy plist", async (t) => {
  const home = await pinnedHome(t);
  await fs.writeFile(
    process.env.SCOUT_LAUNCH_AGENT_PLIST!,
    legacyPlist({ scriptPath: "/legacy/workspace/cli.js", home }),
  );

  const existing = await readExistingService(home);
  assert.ok(existing);
  assert.equal(existing.environment.SCOUT_SESSION_TIMEOUT_MS, "900000");
  assert.deepEqual(existing.programArguments, [
    "/usr/bin/node",
    "/legacy/workspace/cli.js",
    "run",
  ]);
  // The live plist carries no --port. Reproducing `undefined` rather than
  // defaulting is what keeps a stray SCOUT_AGENT_PORT off 47821.
  assert.equal(existing.port, undefined);
  assert.deepEqual(droppedEnvKeys(existing.environment), [
    "SCOUT_SESSION_TIMEOUT_MS",
  ]);
});

test("SCOUT_SESSION_TIMEOUT_MS survives a legacy to current round-trip", async (t) => {
  const home = await pinnedHome(t);
  if (process.platform !== "darwin") return;
  await fs.writeFile(
    process.env.SCOUT_LAUNCH_AGENT_PLIST!,
    legacyPlist({ scriptPath: "/legacy/workspace/cli.js", home }),
  );

  const before = await readExistingService(home);
  const extraEnv: Record<string, string> = {};
  for (const key of droppedEnvKeys(before!.environment)) {
    extraEnv[key] = before!.environment[key];
  }

  await installService({
    home,
    port: before!.port,
    scriptPath: "/tmp/agent/current/dist/cli.js",
    extraEnv,
    bootstrap: noopBootstrap,
  });

  const after = await readExistingService(home);
  assert.equal(after!.environment.SCOUT_SESSION_TIMEOUT_MS, "900000");
  assert.equal(after!.port, undefined, "an absent port must stay absent");
  assert.ok(!after!.programArguments.includes("--port"));
  assert.deepEqual(droppedEnvKeys(after!.environment, extraEnv), []);
});

test("buildLaunchAgentPlist emits extra env and never shadows HOME or PATH", () => {
  const xml = buildLaunchAgentPlist({
    nodePath: "/usr/bin/node",
    scriptPath: "/tmp/agent/current/dist/cli.js",
    logPath: "/tmp/log",
    home: "/Users/x",
    pathEnv: "/usr/bin",
    extraEnv: { SCOUT_SESSION_TIMEOUT_MS: "900000", HOME: "/evil" },
  });

  assert.match(
    xml,
    /<key>SCOUT_SESSION_TIMEOUT_MS<\/key>\s*<string>900000<\/string>/,
  );
  assert.doesNotMatch(xml, /<string>\/evil<\/string>/);
  assert.equal(xml.match(/<key>HOME<\/key>/g)?.length, 1);
  assert.ok(isPlistStructurallyValid(xml));
});
