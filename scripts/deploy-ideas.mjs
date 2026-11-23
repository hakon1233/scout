#!/usr/bin/env node
// Builds the hosted web app (scripts/build-ideas.mjs, served from the root) and
// deploys it to the Cloudflare Pages test site (project scout-ideas, branch
// ideas). The GitHub Pages site is untouched.
//
// Needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in
// the environment.

import { buildIdeas, getJson, requireEnv, run } from "./build-ideas.mjs";

const PAGES_PROJECT = "scout-ideas";
const BRANCH = "ideas";

const env = process.env;
requireEnv(env);

await buildIdeas(env);

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
