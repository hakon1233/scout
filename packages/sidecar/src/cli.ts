#!/usr/bin/env node
import { DEFAULT_PORT, listen } from "./server.js";

async function main() {
  const argPort = process.argv.find((a) => a.startsWith("--port="));
  const port = argPort
    ? Number(argPort.slice("--port=".length))
    : DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`[sidecar] invalid port: ${argPort}`);
    process.exit(2);
  }
  const handle = await listen(port);
  console.log(
    `[sidecar] listening on http://127.0.0.1:${handle.port}  (POST /anthropic/messages, POST /exa/search)`,
  );
  const shutdown = async (signal: string) => {
    console.log(`[sidecar] ${signal} — shutting down`);
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[sidecar] failed to start:", err);
  process.exit(1);
});
