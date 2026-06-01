// PER-152 visual verification (NOT a shipped file — local screenshot harness).
// Boots the packed companion in a hermetic HOME with seeded schedule telemetry,
// serves the real /app/ bundle same-origin, then screenshots the Settings
// screen (schedule section) at desktop 1440x900 and mobile 390x844.
//
// SAFETY: HOME is a throwaway dir and SCOUT_CLAUDE_BIN points at the offline
// stub, so the developer's real ~/.config/scout and OAuth token are never read,
// spawned, or logged.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { buildArtifact } from "./build-artifact.mjs";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = "47931";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STUB_CLAUDE = path.join(E2E_DIR, "fixtures", "stub-claude.mjs");
const SHOTS = path.join(E2E_DIR, ".artifact", "shots");

const { cliEntry } = buildArtifact();

const HOME = path.join(E2E_DIR, ".artifact", "home-per152");
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const childEnv = { ...process.env, HOME, SCOUT_CLAUDE_BIN: STUB_CLAUDE };

// 1. Pair (mints token + state.json in hermetic HOME).
execFileSync(process.execPath, [cliEntry, "pair"], {
  env: childEnv,
  stdio: ["ignore", "ignore", "inherit"],
});

// 2. Seed schedule telemetry so the legibility row shows real last/next-run.
const stateFile = path.join(HOME, ".config", "scout", "state.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
state.schedule = {
  enabled: true,
  time_of_day: "07:00",
  last_run_at: "2026-06-02T07:00:11.000Z",
  last_run_status: "success",
  last_run_note: null,
  next_run_at: "2026-06-03T07:00:00.000Z",
};
writeFileSync(stateFile, JSON.stringify(state, null, 2));

// 3. Run the companion.
const server = spawn(process.execPath, [cliEntry, "run", "--port", PORT], {
  env: childEnv,
  stdio: "inherit",
});

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${ORIGIN}/healthz`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("companion never became healthy");
}

async function main() {
  await waitHealthy();
  const browser = await chromium.launch();

  // Seed localStorage so the app is past first-run; the pairing token
  // auto-bootstraps same-origin via /v0/config. Then enter the Settings screen.
  const settings = {
    name: "Alex",
    interests: [
      { id: "int_0_AI safety", topic: "AI safety" },
      { id: "int_1_F1 racing", topic: "F1 racing" },
    ],
  };

  async function shot(name, width, height) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/app/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => {
      localStorage.setItem("scout.settings.v1", JSON.stringify(s));
    }, settings);
    await page.reload({ waitUntil: "networkidle" });
    // Enter the Settings screen (where the schedule section lives).
    await page.getByRole("button", { name: "Manage interests" }).first().click();
    // Wait for the schedule section to resolve (toggle is the tell).
    await page.getByRole("switch").waitFor({ timeout: 8000 });
    await sleep(400);
    await page.screenshot({
      path: path.join(SHOTS, `${name}.png`),
      fullPage: true,
    });
    console.log(`shot: ${name} (${width}x${height})`);
    await ctx.close();
  }

  await shot("settings-desktop", 1440, 900);
  await shot("settings-mobile", 390, 844);

  await browser.close();
  server.kill("SIGTERM");
  console.log(`\nScreenshots in ${SHOTS}`);
}

main().catch((e) => {
  console.error(e);
  server.kill("SIGTERM");
  process.exit(1);
});
