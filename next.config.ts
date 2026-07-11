import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const basePath = repo ? `/${repo}` : "";

// Single-source the companion version from packages/agent/package.json so the
// Connect page's tarball URL can never drift from the version the deploy
// actually packs and names the tarball after (PER-275 — a hand-duplicated
// version used to silently 404 the onboarding install command on a bump).
const agentPkgPath = fileURLToPath(
  new URL("./packages/agent/package.json", import.meta.url),
);
const agentVersion = (
  JSON.parse(readFileSync(agentPkgPath, "utf8")) as { version: string }
).version;
if (!agentVersion) {
  throw new Error(`missing "version" in ${agentPkgPath}`);
}

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AGENT_VERSION: agentVersion,
  },
  trailingSlash: true,
};

export default nextConfig;
