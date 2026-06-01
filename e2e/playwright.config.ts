import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Headless E2E for the zero-prompt first-run core loop (PER-119). The webServer
// builds + packs + boots the @scout/agent artifact and serves the app from its
// own loopback origin; tests assert the no-paste auto-adoption, brief render,
// and the same-origin/cross-origin /v0/config guard. One command, fully offline.
//
// Paths are relative so Playwright resolves them against this config's dir
// (testDir) and the repo-root cwd (webServer command) — no ESM-only
// import.meta.url, which Playwright's CJS config loader chokes on.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: ".artifact/test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Artifact-on-failure: screenshot + trace so a CI regression is debuggable
    // without re-running locally.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // cwd defaults to this config's directory (e2e/), so the path is relative
    // to it. start-companion.mjs derives the repo root from its own location.
    command: "node start-companion.mjs",
    url: `${BASE_URL}/healthz`,
    // First run builds the Next.js static export + compiles + packs the tarball,
    // which is slow on a cold cache — give it room.
    timeout: 240_000,
    // Never reuse an already-listening server: a globally-installed
    // `scout-agent` (or a prior dev instance) squatting on 47821 would be
    // reused instead of OUR freshly-packed, stub-wired artifact — the test
    // would then silently exercise the wrong binary with real `claude` and no
    // stub. Always boot our own; fail loudly if the port is occupied.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
