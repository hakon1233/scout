import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// GitHub Pages serves the site under /<repo>; SCOUT_BASE_PATH overrides it
// ("" for a site served from the root, as `pnpm deploy:ideas` does).
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const basePath = process.env.SCOUT_BASE_PATH ?? (repo ? `/${repo}` : "");

// Single-source the companion version from packages/agent/package.json so the
// Connect page's tarball URL can never drift from the version the deploy
// actually packs and names the tarball after (a hand-duplicated version used to
// silently 404 the onboarding install command on a bump).
const agentPkgPath = fileURLToPath(
  new URL("./packages/agent/package.json", import.meta.url),
);
const agentVersion = (
  JSON.parse(readFileSync(agentPkgPath, "utf8")) as { version: string }
).version;
if (!agentVersion) {
  throw new Error(`missing "version" in ${agentPkgPath}`);
}

// The fake hosted backend (src/lib/hosted-fake.ts) is for dev and e2e
// servers only; a production build with its flag set is refused.
export function assertNoFakeInProduction(env: NodeJS.ProcessEnv): void {
  if (
    env.NODE_ENV === "production" &&
    env.NEXT_PUBLIC_SCOUT_FAKE_HOSTED !== undefined
  ) {
    throw new Error(
      "NEXT_PUBLIC_SCOUT_FAKE_HOSTED is for dev and e2e servers only; unset it to build.",
    );
  }
}
assertNoFakeInProduction(process.env);

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AGENT_VERSION: agentVersion,
  },
  trailingSlash: true,
  // agentRules stays on: AGENTS.md carries the current block, so `next dev`
  // leaves it alone. Turning it off makes Next 16.4+ delete the block.
};

export default nextConfig;
