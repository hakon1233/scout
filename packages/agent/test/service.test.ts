// LaunchAgent service tests (PER-153). Hermetic: only the PURE plist builder and
// the filesystem-presence detection are exercised — no launchctl is invoked, so
// these touch nothing on the host's real launchd domain.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LAUNCH_AGENT_LABEL,
  buildLaunchAgentPlist,
  isServiceInstalled,
  plistPath,
} from "../src/service.js";

test("buildLaunchAgentPlist emits RunAtLoad + KeepAlive and the run argv", () => {
  const xml = buildLaunchAgentPlist({
    nodePath: "/usr/local/bin/node",
    scriptPath: "/opt/scout/dist/cli.js",
    logPath: "/Users/x/Library/Logs/scout-agent.log",
    home: "/Users/x",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });
  // RunAtLoad + KeepAlive are the durability guarantee.
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  // Label matches what detection/uninstall look for.
  assert.match(xml, new RegExp(`<string>${LAUNCH_AGENT_LABEL}</string>`));
  // ProgramArguments = node + cli.js + run (no port unless asked).
  assert.match(xml, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(xml, /<string>\/opt\/scout\/dist\/cli\.js<\/string>/);
  assert.match(xml, /<string>run<\/string>/);
  assert.doesNotMatch(xml, /--port/);
  // HOME + PATH are pinned so the spawned `claude` is resolvable under launchd.
  assert.match(xml, /<key>HOME<\/key>\s*<string>\/Users\/x<\/string>/);
  assert.match(
    xml,
    /<key>PATH<\/key>\s*<string>\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/,
  );
  // Well-formed-ish: single plist root, balanced.
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<\/plist>\s*$/);
});

test("buildLaunchAgentPlist threads an explicit --port", () => {
  const xml = buildLaunchAgentPlist({
    nodePath: "/n",
    scriptPath: "/s",
    port: 47899,
    logPath: "/l",
    home: "/h",
    pathEnv: "/bin",
  });
  assert.match(xml, /<string>--port<\/string>\s*<string>47899<\/string>/);
});

test("buildLaunchAgentPlist xml-escapes paths with special chars", () => {
  const xml = buildLaunchAgentPlist({
    nodePath: "/n",
    scriptPath: "/Users/a&b/cli.js",
    logPath: "/l",
    home: "/Users/a&b",
    pathEnv: "/bin",
  });
  assert.match(xml, /\/Users\/a&amp;b\/cli\.js/);
  assert.doesNotMatch(xml, /a&b\/cli/); // raw & never leaks
});

test("isServiceInstalled tracks plist validity, not mere presence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-svc-"));
  const p = path.join(tmp, "ing.scout.agent.plist");
  const prev = process.env.SCOUT_LAUNCH_AGENT_PLIST;
  process.env.SCOUT_LAUNCH_AGENT_PLIST = p;
  try {
    assert.equal(plistPath(), p);
    assert.equal(isServiceInstalled(), false);
    await fs.writeFile(
      p,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ing.scout.agent</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/node</string>
      <string>/tmp/cli.js</string>
      <string>run</string>
    </array>
  </dict>
</plist>
`,
    );
    assert.equal(isServiceInstalled(), true);

    // Existence is not validity: a truncated write (what a non-atomic plist
    // rewrite leaves behind) must not report the companion reboot-durable
    // when launchd would fail to bootstrap it at next login (PER-303).
    await fs.writeFile(p, "<plist/>");
    assert.equal(isServiceInstalled(), false);

    await fs.rm(p);
    assert.equal(isServiceInstalled(), false);
  } finally {
    if (prev === undefined) delete process.env.SCOUT_LAUNCH_AGENT_PLIST;
    else process.env.SCOUT_LAUNCH_AGENT_PLIST = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
