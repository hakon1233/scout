// The gateway's automatic sign-in (local-signin.ts) through the real static
// server, against a fake Worker on an ephemeral loopback port. No network,
// no claude, never 47821 or 47900.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { startLocalServer } from "../../../scripts/local-server.mjs";
import { createLocalSignIn, LOCAL_SIGNIN_PATH } from "../src/local-signin.js";

const TOKEN = "team-secret-do-not-print";
const OWNER = "owner@example.test";

async function fakeWorker(status = 200) {
  const seen: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    seen.push(req);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        req.url === "/team/local-session" &&
          req.headers.authorization === `Bearer ${TOKEN}`
          ? {
              accessToken: "acc.ess",
              refreshToken: "ref+resh",
              expiresIn: 3600,
              tokenType: "bearer",
            }
          : { error: "wrong token" },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, seen };
}

async function withGateway(
  opts: { allowedLogin?: string; workerStatus?: number },
  fn: (
    get: (headers?: Record<string, string>) => Promise<Response>,
    worker: Awaited<ReturnType<typeof fakeWorker>>,
  ) => Promise<void>,
) {
  const worker = await fakeWorker(opts.workerStatus);
  const root = mkdtempSync(path.join(os.tmpdir(), "scout-signin-site-"));
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(path.join(root, "app", "index.html"), "app shell");
  const logs: string[] = [];
  const gateway: Server = await startLocalServer({
    root,
    port: 0,
    routes: {
      [LOCAL_SIGNIN_PATH]: createLocalSignIn({
        workerUrl: worker.url,
        token: TOKEN,
        allowedLogin: opts.allowedLogin,
        log: (l) => logs.push(l),
      }),
    },
  });
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  try {
    await fn(
      (headers = {}) =>
        fetch(base + LOCAL_SIGNIN_PATH, { headers, redirect: "manual" }),
      worker,
    );
  } finally {
    gateway.close();
    worker.server.close();
  }
  assert.doesNotMatch(logs.join("\n"), new RegExp(TOKEN));
}

test("no Tailscale login header: 403, and the Worker is not asked", async () => {
  await withGateway({ allowedLogin: OWNER }, async (get, worker) => {
    const res = await get();
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("location"), null);
    assert.equal(worker.seen.length, 0);
  });
});

test("another tailnet login: 403", async () => {
  await withGateway({ allowedLogin: OWNER }, async (get, worker) => {
    for (const login of ["someone@example.test", "", `${OWNER}.evil`]) {
      const res = await get({ "Tailscale-User-Login": login });
      assert.equal(res.status, 403);
    }
    assert.equal(worker.seen.length, 0);
  });
});

test("no allowed login configured: 403 even with a header", async () => {
  await withGateway({}, async (get, worker) => {
    const res = await get({ "Tailscale-User-Login": OWNER });
    assert.equal(res.status, 403);
    assert.equal(worker.seen.length, 0);
  });
});

test("the owner's login: redirect to the sign-in page with the session in the fragment", async () => {
  await withGateway({ allowedLogin: OWNER }, async (get, worker) => {
    const res = await get({ "Tailscale-User-Login": "Owner@Example.test" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const location = res.headers.get("location") ?? "";
    const [page, fragment] = location.split("#");
    assert.equal(page, "/app/signin/");
    const params = new URLSearchParams(fragment);
    assert.equal(params.get("access_token"), "acc.ess");
    assert.equal(params.get("refresh_token"), "ref+resh");
    assert.equal(params.get("expires_in"), "3600");
    assert.equal(params.get("token_type"), "bearer");
    // The token goes to the Worker only, as the bearer.
    assert.equal(worker.seen.length, 1);
    assert.equal(worker.seen[0].method, "POST");
    assert.equal(worker.seen[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(location, new RegExp(TOKEN));
  });
});

test("the Worker failing: 502, no redirect", async () => {
  await withGateway({ allowedLogin: OWNER, workerStatus: 502 }, async (get) => {
    const res = await get({ "Tailscale-User-Login": OWNER });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("location"), null);
  });
});
