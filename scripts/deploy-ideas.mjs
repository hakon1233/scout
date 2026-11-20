#!/usr/bin/env node
// Builds the hosted web app and deploys it to the Cloudflare Pages test site
// (project scout-ideas, branch ideas), served from the root. The GitHub Pages
// site is untouched.
//
// Needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in
// the environment. The anon key is read from the Management API at build time
// (public by design, but never committed). The Worker URL is where the Worker
// will live on the account's workers.dev subdomain; until it is deployed, chat
// and run now say the server can't be reached.

import { spawnSync } from "node:child_process";

const REF = "qctcuajvefuicasakgkq";
const PAGES_PROJECT = "scout-ideas";
const BRANCH = "ideas";
const WORKER_NAME = "scout-runs"; // packages/worker/wrangler.toml

const env = process.env;
for (const k of [
  "SUPABASE_ACCESS_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
]) {
  if (!env[k]) throw new Error(`set ${k}`);
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const keys = await getJson(
  `https://api.supabase.com/v1/projects/${REF}/api-keys`,
  env.SUPABASE_ACCESS_TOKEN,
);
const anon = keys.find((k) => k.name === "anon")?.api_key;
if (!anon) throw new Error("no anon key on the project");

const sub = await getJson(
  `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,
  env.CLOUDFLARE_API_TOKEN,
);
const subdomain = sub.result?.subdomain;

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["build"], {
  SCOUT_BASE_PATH: "",
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  NEXT_PUBLIC_SCOUT_WORKER_URL: subdomain
    ? `https://${WORKER_NAME}.${subdomain}.workers.dev`
    : "",
});

const projects = await getJson(
  `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`,
  env.CLOUDFLARE_API_TOKEN,
);
if (!projects.result.some((p) => p.name === PAGES_PROJECT)) {
  // Through the API: wrangler's `pages project create` now tries to set up a
  // Workers project from the repo's frameworks and fails on this monorepo.
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: PAGES_PROJECT, production_branch: BRANCH }),
    },
  );
  if (!res.ok) throw new Error(`create Pages project: ${await res.text()}`);
}

run("npx", [
  "--yes",
  "wrangler@4",
  "pages",
  "deploy",
  "out",
  "--project-name",
  PAGES_PROJECT,
  "--branch",
  BRANCH,
  "--commit-dirty=true",
]);
