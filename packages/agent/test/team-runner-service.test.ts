// The team runner's launchd service: the plist it writes and the launchctl
// calls it makes, in a temporary home with a stubbed launchctl. Never the
// real launchd, never the real ~/Library.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTeamRunnerPlist,
  installTeamRunnerService,
  TEAM_RUNNER_LABEL,
  teamRunnerPlistPath,
  uninstallTeamRunnerService,
} from "../src/team-runner-service.js";

const REPO = "/Users/someone/projects/scout";

test("the plist runs `team:run --loop` from the checkout, kept alive, with no secret", () => {
  const xml = buildTeamRunnerPlist({
    nodePath: "/opt/homebrew/opt/node/bin/node",
    repoDir: REPO,
    home: "/Users/someone",
    pathEnv: "/opt/homebrew/bin:/usr/bin",
  });
  const args = [
    ...xml
      .match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)![1]
      .matchAll(/<string>(.*?)<\/string>/g),
  ].map((m) => m[1]);
  assert.deepEqual(args, [
    "/opt/homebrew/opt/node/bin/node",
    `${REPO}/node_modules/tsx/dist/cli.mjs`,
    "--conditions=source",
    `${REPO}/scripts/team-run.mts`,
    "--loop",
  ]);
  assert.match(xml, new RegExp(`<string>${TEAM_RUNNER_LABEL}</string>`));
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>SCOUT_TEAM_RUNNER<\/key>\s*<string>on<\/string>/);
  // Long enough for a run in progress to publish after SIGTERM.
  assert.match(xml, /<key>ExitTimeOut<\/key>\s*<integer>540<\/integer>/);
  assert.doesNotMatch(xml, /TOKEN/);
});

test("install writes the plist and loads it; uninstall unloads and removes it", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "scout-team-svc-"));
  const calls: string[][] = [];
  const launchctl = async (args: string[]) => void calls.push(args);

  await installTeamRunnerService({
    repoDir: REPO,
    home,
    launchctl,
    nodePath: "/usr/local/bin/node",
    pathEnv: "/usr/bin",
    uid: 501,
  });
  const plist = teamRunnerPlistPath(home);
  assert.ok(plist.startsWith(home));
  assert.match(readFileSync(plist, "utf8"), /--loop/);
  assert.deepEqual(calls, [
    ["bootout", `gui/501/${TEAM_RUNNER_LABEL}`],
    ["bootstrap", "gui/501", plist],
  ]);

  calls.length = 0;
  await uninstallTeamRunnerService({ home, launchctl, uid: 501 });
  assert.deepEqual(calls, [["bootout", `gui/501/${TEAM_RUNNER_LABEL}`]]);
  assert.ok(!existsSync(plist));
});

test("without a stub, launchctl refuses under the test runner", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "scout-team-svc-"));
  await assert.rejects(
    installTeamRunnerService({
      repoDir: REPO,
      home,
      nodePath: "/usr/local/bin/node",
      pathEnv: "/usr/bin",
    }),
    /test runner/,
  );
});
