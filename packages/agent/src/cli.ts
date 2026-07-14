#!/usr/bin/env node
// @scout/agent — local loopback companion CLI.
//
// Subcommands:
//   pair          Generate and store a local pairing token. No paste needed:
//                 `scout-agent run` serves the Scout UI from this loopback
//                 origin, so the browser auto-adopts the token same-origin
//                 (PER-110). Reuses an existing token if one is stored; pass
//                 --force (alias --reset) to mint a fresh token and invalidate
//                 the old one.
//   run (default) Start the loopback HTTP server on 127.0.0.1.
//   status        Print pairing + last-brief state.
//   install-service    Install a macOS launchd LaunchAgent so the companion
//                      starts at login/boot and respawns if it exits (PER-153).
//                      Makes the schedule reboot-durable.
//   uninstall-service  Remove the LaunchAgent (companion no longer reboot-durable).
//   service-status     Print whether the LaunchAgent is installed + loaded.
//
// Constraint: we MUST NOT transmit the user's Anthropic OAuth token
// (`sk-ant-oat01-…`) off-machine. Synthesis runs by spawning the user's local
// `claude` CLI; we never read or forward that token.

import {
  defaultSchedule,
  loadState,
  resolvePairingToken,
  saveState,
  STATE_FILE,
} from "./state.js";
import { PKG_VERSION, defaultPort, startServer } from "./server.js";
import { Scheduler } from "./scheduler.js";
import {
  installService,
  isServiceInstalled,
  serviceStatus,
  uninstallService,
} from "./service.js";

async function cmdPair(force: boolean): Promise<void> {
  const state = await loadState();
  const had = Boolean(state.pairing_token);
  const { token, rotated } = resolvePairingToken(state, force);
  await saveState({ ...state, pairing_token: token });

  if (had && !rotated) {
    console.log("Reusing existing pairing token (run `scout-agent pair --force` to rotate).\n");
  } else if (had && rotated) {
    console.log("Rotated pairing token — the previous token is now invalid.\n");
  }
  console.log("Pairing token (stored locally — no need to paste it anywhere):\n");
  console.log(`  ${token}\n`);
  console.log(`Stored at ${STATE_FILE}.`);
  console.log(
    "Next: run `scout-agent run`, then open the printed http://127.0.0.1 URL.\n" +
      "The Scout UI is served from this companion, so the browser adopts the token\n" +
      "automatically — no copy/paste step.",
  );
}

async function cmdStatus(): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.log("not paired. run `scout-agent pair` first.");
    return;
  }
  console.log(`paired (token: ${state.pairing_token.slice(0, 8)}…)`);
  const b = state.last_brief;
  if (!b) console.log("no briefs yet.");
  else console.log(`last brief: ${b.status} @ ${b.generated_at} (${b.id})`);
}

async function cmdRun(portArg?: string): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.error("not paired. run `scout-agent pair` first.");
    process.exit(1);
  }
  // Materialize the default schedule on first run so the in-process scheduler
  // has concrete config to resume after a restart (PER-151). Existing config is
  // left untouched so a founder's enable/disable + time choice survives restart.
  if (!state.schedule) {
    await saveState({ ...state, schedule: defaultSchedule() });
  }

  const port = defaultPort(portArg);

  // The scheduler fires the same run path the HTTP endpoint does; they share an
  // in-memory single-flight guard (runner.ts) so runs never overlap.
  const scheduler = new Scheduler({ stateFile: STATE_FILE });
  const { port: bound } = await startServer(port, {
    onScheduleChanged: () => scheduler.reschedule(),
  });
  await scheduler.start();

  const url = `http://127.0.0.1:${bound}`;
  console.log(`@scout/agent v${PKG_VERSION} listening on ${url}`);
  console.log(`\n  Open Scout in your browser:  ${url}/app/\n`);
  console.log(
    "Serving the Scout UI from this loopback origin means the page is same-origin\n" +
      'with the API — no "Allow local network" prompt, no pairing token to paste.',
  );
  const sched = (await loadState()).schedule;
  if (sched?.enabled) {
    const durable = isServiceInstalled();
    const durabilityNote = durable
      ? "  Reboot-durable: a launchd LaunchAgent is installed, so this resumes\n" +
        "  automatically after login/boot."
      : "  Note: this only runs while THIS process is alive. After a reboot,\n" +
        "  re-run `scout-agent run` — or `scout-agent install-service` once to\n" +
        "  make it reboot-durable.";
    console.log(
      `\nScheduler: daily at ${sched.time_of_day} (local). Next: ${sched.next_run_at ?? "—"}.\n` +
        durabilityNote,
    );
  }
  console.log(
    "\nEndpoints: GET /healthz, POST /v0/interests, GET /v0/briefs?since=<iso>, GET|PUT /v0/schedule",
  );
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "pair": {
        const force = rest.includes("--force") || rest.includes("--reset");
        await cmdPair(force);
        break;
      }
      case "status":
        await cmdStatus();
        break;
      case "install-service": {
        const portFlagIdx = rest.indexOf("--port");
        const port = portFlagIdx >= 0 ? Number(rest[portFlagIdx + 1]) : undefined;
        const r = await installService({
          port: port && Number.isFinite(port) ? port : undefined,
        });
        console.log(`Wrote ${r.plist}`);
        console.log(r.note);
        if (r.bootstrapped) {
          console.log(
            "The companion is now reboot-durable — `/v0/schedule` reports reboot_durable:true\n" +
              "and the Settings UI drops the reboot caveat.",
          );
        } else {
          process.exitCode = 1;
        }
        break;
      }
      case "uninstall-service": {
        const r = await uninstallService();
        console.log(r.note);
        if (!r.removed) process.exitCode = 1;
        break;
      }
      case "service-status": {
        const s = await serviceStatus();
        console.log(`installed: ${s.installed} (${s.plist})`);
        console.log(`loaded:    ${s.loaded === null ? "unknown" : s.loaded}`);
        break;
      }
      case "run":
      case undefined: {
        const portFlagIdx = rest.indexOf("--port");
        const port = portFlagIdx >= 0 ? rest[portFlagIdx + 1] : undefined;
        await cmdRun(port);
        break;
      }
      default:
        console.error(
          `unknown command: ${cmd}. usage: scout-agent [pair|run|status|install-service|uninstall-service|service-status]`,
        );
        process.exit(2);
    }
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

main();
