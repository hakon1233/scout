// Boots the sidecar with a stubbed upstream fetch and exercises CORS, healthz,
// the Anthropic proxy (identity-block injection + token usage logging), and
// the Exa proxy (missing-key path).

import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { listen, ANTHROPIC_URL, EXA_URL } from "../src/server.js";
import { clearCachedToken } from "../src/auth.js";

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type UpstreamCall = { url: string; init: FetchInit };
const calls: UpstreamCall[] = [];

const originalFetch = globalThis.fetch;
let stubResponse: { status: number; body: unknown; contentType?: string } = {
  status: 200,
  body: {},
};

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = typeof input === "string" ? input : input.toString();
  const headers: Record<string, string> = {};
  if (init?.headers) {
    for (const [k, v] of Object.entries(
      init.headers as Record<string, string>,
    )) {
      headers[k.toLowerCase()] = String(v);
    }
  }
  calls.push({
    url,
    init: {
      method: init?.method,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    },
  });
  const text = JSON.stringify(stubResponse.body);
  return new Response(text, {
    status: stubResponse.status,
    headers: { "content-type": stubResponse.contentType ?? "application/json" },
  });
}) as typeof fetch;

async function request(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setExaEnvKey(key: string | null) {
  const dir = path.join(os.homedir(), ".scout-sidecar");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, ".env");
  if (key) await fs.writeFile(file, `EXA_API_KEY=${key}\n`, { mode: 0o600 });
  else await fs.rm(file, { force: true });
}

async function main() {
  process.env.SCOUT_SIDECAR_PORT = "0";
  delete process.env.EXA_API_KEY;
  await setExaEnvKey("exa_test_key_123");

  // Force a deterministic OAuth token by short-circuiting the keychain read
  // via the EXA env-loader path? No — instead, monkey-patch the auth module
  // through environment. The simplest: write a credentials file and clear
  // any cached value.
  const credsPath = path.join(os.homedir(), ".claude", ".credentials.json");
  const credsBackup = await fs
    .readFile(credsPath, "utf8")
    .catch(() => null);
  // Only write a stub if there's no real file — never clobber a real one.
  if (!credsBackup) {
    await fs.mkdir(path.dirname(credsPath), { recursive: true });
    await fs.writeFile(
      credsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-TESTTOKEN",
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
      { mode: 0o600 },
    );
  }
  clearCachedToken();

  const handle = await listen(0);
  const port = handle.port;
  try {
    // healthz
    const h = await request(port, "GET", "/healthz");
    assert.equal(h.status, 200, "healthz 200");
    assert.match(h.body, /scout-sidecar/);

    // CORS preflight from allowed origin
    const pre = await request(port, "OPTIONS", "/anthropic/messages", undefined, {
      origin: "http://localhost:3000",
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], "http://localhost:3000");

    // Disallowed origin
    const bad = await request(port, "POST", "/anthropic/messages", { model: "x" }, {
      origin: "https://evil.example.com",
    });
    assert.equal(bad.status, 403, "non-localhost origin rejected");

    // Anthropic proxy: identity block injected, token usage logged
    stubResponse = {
      status: 200,
      body: {
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 12, output_tokens: 7 },
      },
    };
    calls.length = 0;
    const ant = await request(
      port,
      "POST",
      "/anthropic/messages",
      {
        model: "claude-opus-4-7",
        max_tokens: 100,
        system: "Pre-existing system prompt.",
        messages: [{ role: "user", content: "hi" }],
      },
      { origin: "http://127.0.0.1:3000" },
    );
    assert.equal(ant.status, 200);
    assert.equal(calls.length, 1, "one upstream call");
    assert.equal(calls[0].url, ANTHROPIC_URL);
    assert.match(
      calls[0].init.headers?.authorization ?? "",
      /^Bearer sk-ant-oat01-/,
      "OAuth bearer forwarded with sk-ant-oat01 prefix",
    );
    assert.equal(calls[0].init.headers?.["anthropic-beta"], "oauth-2025-04-20");
    const forwarded = JSON.parse(calls[0].init.body ?? "{}");
    assert.ok(Array.isArray(forwarded.system));
    assert.equal(forwarded.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
    assert.equal(forwarded.system[1].text, "Pre-existing system prompt.");
    assert.equal(forwarded.model, "claude-opus-4-7");

    // Exa proxy success
    stubResponse = { status: 200, body: { results: [{ url: "https://a" }, { url: "https://b" }] } };
    calls.length = 0;
    const exa = await request(port, "POST", "/exa/search", { query: "ai safety", numResults: 2 }, {
      origin: "http://localhost:3000",
    });
    assert.equal(exa.status, 200);
    assert.equal(calls[0].url, EXA_URL);
    assert.equal(calls[0].init.headers?.["x-api-key"], "exa_test_key_123");

    // Exa missing key
    await setExaEnvKey(null);
    const exaNoKey = await request(port, "POST", "/exa/search", { query: "x" }, {
      origin: "http://localhost:3000",
    });
    assert.equal(exaNoKey.status, 401);
    assert.match(exaNoKey.body, /no_exa_key/);

    console.log("ok — all proxy tests passed");
  } finally {
    await handle.close();
    if (!credsBackup) {
      await fs.rm(credsPath, { force: true });
    }
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
