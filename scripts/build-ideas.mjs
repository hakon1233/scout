#!/usr/bin/env node
// Builds the hosted web app into out/, served from the root: the build that
// goes to the Cloudflare Pages test site (`pnpm deploy:ideas`) and to the
// founder's local Scout on the Mac (`pnpm local:serve`).
//
// Needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in
// the environment. The anon key is read from the Management API at build time
// (public by design, but never committed). The Worker URL is where the Worker
// lives on the account's workers.dev subdomain; until it is deployed, chat and
// run now say the server can't be reached.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fillHeaders } from "./csp-headers.mjs";

const REF = "qctcuajvefuicasakgkq";
const WORKER_NAME = "scout-runs"; // packages/worker/wrangler.toml
// The public half of the Worker's VAPID pair (wrangler.toml); public by design.
const VAPID_PUBLIC_KEY =
  "BI6UnDSibkd7O63kgma8diRbDNqciOAYM00hAVYqp-nsn-TAP1AsHpGyEmG3Psj6u1ALdIQKAJZzbZYBLnAMyhE";

export function requireEnv(env = process.env, { cloudflare = true } = {}) {
  for (const k of [
    "SUPABASE_ACCESS_TOKEN",
    ...(cloudflare ? ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] : []),
  ]) {
    if (!env[k]) throw new Error(`set ${k}`);
  }
}

export async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function workersDevUrl(env) {
  const sub = await getJson(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,
    env.CLOUDFLARE_API_TOKEN,
  );
  const subdomain = sub.result?.subdomain;
  return subdomain ? `https://${WORKER_NAME}.${subdomain}.workers.dev` : "";
}

/**
 * Builds the hosted web app into out/, with out/_headers filled in. `worker`
 * sets the app's Worker URL; the Mac's build sets its own origin, where the
 * gateway (scripts/local-gateway.mts) relays to the Worker. Unset, the
 * deployed Worker's workers.dev URL, which needs the Cloudflare tokens.
 * `localSignin` (the Mac's build) makes the sign-in page go straight to the
 * gateway's automatic sign-in (packages/agent/src/local-signin.ts).
 */
export async function buildIdeas(
  env = process.env,
  { worker: workerUrl, localSignin = false } = {},
) {
  requireEnv(env, { cloudflare: !workerUrl });

  const keys = await getJson(
    `https://api.supabase.com/v1/projects/${REF}/api-keys`,
    env.SUPABASE_ACCESS_TOKEN,
  );
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error("no anon key on the project");

  const worker = workerUrl ?? (await workersDevUrl(env));

  run("pnpm", ["build"], {
    SCOUT_BASE_PATH: "",
    // The test site is never the real site: noindex on every page (src/lib/seo.ts).
    SCOUT_INDEXED_SITE: "",
    NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SCOUT_WORKER_URL: worker,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_SCOUT_LOCAL_SIGNIN: localSignin ? "1" : "",
  });

  // The Content-Security-Policy (public/_headers) names this build's inline
  // scripts and the two origins the app calls.
  fillHeaders("out", { supabase: `https://${REF}.supabase.co`, worker });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await buildIdeas();
}
