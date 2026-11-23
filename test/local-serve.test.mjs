// The local Scout server (scripts/local-server.mjs) against a throwaway site
// on an ephemeral loopback port, and the launchd plist local-serve.mjs writes.
// Never launchctl, never port 47821 or 47900.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHeaders, startLocalServer } from "../scripts/local-server.mjs";
import {
  buildLocalWebPlist,
  install,
  localPaths,
} from "../scripts/local-serve.mjs";

const CSP = "default-src 'self'; frame-ancestors 'none'";

function site() {
  const root = mkdtempSync(path.join(os.tmpdir(), "scout-local-site-"));
  const put = (rel, body) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put("index.html", "landing");
  put("404.html", "not here");
  put("app/index.html", "app shell");
  put("app/signin/index.html", "sign in");
  put("_next/static/a.js", "js");
  put(
    "_headers",
    `# comment\n/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n`,
  );
  return root;
}

async function withServer(fn) {
  const server = await startLocalServer({ root: site(), port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn((p) => fetch(base + p, { redirect: "manual" }));
  } finally {
    server.close();
  }
}

test("parseHeaders reads a Pages _headers file", () => {
  assert.deepEqual(parseHeaders("# x\n/*\n  A: b: c\n/app/*\n  D: e\n"), [
    { pattern: "/*", headers: { A: "b: c" } },
    { pattern: "/app/*", headers: { D: "e" } },
  ]);
});

test("serves routes like Pages, with the _headers security headers", async () => {
  await withServer(async (get) => {
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.equal(await home.text(), "landing");
    assert.equal(home.headers.get("content-security-policy"), CSP);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.equal(home.headers.get("cache-control"), "no-cache");

    assert.equal(await (await get("/app/signin/")).text(), "sign in");
    const bare = await get("/app/signin?x=1");
    assert.equal(bare.status, 308);
    assert.equal(bare.headers.get("location"), "/app/signin/?x=1");

    const deep = await get("/app/settings");
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), "app shell");

    const asset = await get("/_next/static/a.js");
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.match(asset.headers.get("cache-control"), /immutable/);

    const missing = await get("/nope");
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "not here");
    assert.equal(missing.headers.get("content-security-policy"), CSP);
  });
});

test("never serves _headers or anything outside the site", async () => {
  await withServer(async (get) => {
    assert.equal((await get("/_headers")).status, 404);
    assert.equal((await get("/..%2f..%2fetc%2fpasswd")).status, 404);
    assert.equal((await get("/app/x.js")).status, 404);
  });
});

test("the plist runs the copied server on 47900 and keeps it alive", () => {
  const paths = localPaths("/Users/someone");
  const xml = buildLocalWebPlist({ nodePath: "/opt/node", paths });
  assert.match(xml, /<string>ing\.scout\.local-web<\/string>/);
  assert.match(
    xml,
    /<string>\/opt\/node<\/string>\s*<string>\/Users\/someone\/Library\/Application Support\/Scout Local\/local-server\.mjs<\/string>\s*<string>\/Users\/someone\/Library\/Application Support\/Scout Local\/site<\/string>\s*<string>47900<\/string>/,
  );
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.doesNotMatch(xml, /47821|47899/);
});

test("install refuses an out/ without a built app before touching anything", async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "scout-local-out-"));
  await assert.rejects(install({ outDir: empty }), /no built app/);
});
