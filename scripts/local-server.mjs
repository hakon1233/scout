#!/usr/bin/env node
// A tiny static file server for the hosted web app's build (out/), for the
// founder's local Scout on the Mac: 127.0.0.1:47900 behind `tailscale serve`
// (docs/ARCHITECTURE.md, "Local Scout on the Mac"). The gateway
// (scripts/local-gateway.mts) runs it with a `proxy` that takes every request
// other than GET and HEAD: the app's Worker calls, all POSTs, go to the Worker.
//
// It serves like Cloudflare Pages does for this site: directory routes
// resolve to their index.html, an extensionless route without a slash
// redirects to the slashed one, an unknown route under /app/ gets the /app/
// shell, anything else gets 404.html, and every response carries the headers
// from the build's _headers file (the Content-Security-Policy that
// scripts/csp-headers.mjs filled in). The rules mirror
// packages/agent/src/static.ts; this copy is plain JavaScript with no imports
// outside node:.
//
// Usage: node local-server.mjs <site dir> [port]  (static only, no proxy)

import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LOCAL_PORT = 47900;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Parses a Cloudflare Pages _headers file into rules: a path pattern on its
 * own line, then indented `Name: value` lines. `*` matches any rest of a path.
 */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} });
      continue;
    }
    const at = line.indexOf(":");
    if (at < 0 || !rules.length) continue;
    rules[rules.length - 1].headers[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim();
  }
  return rules;
}

function matches(pattern, pathname) {
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

function headersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) {
    if (matches(rule.pattern, pathname)) Object.assign(out, rule.headers);
  }
  return out;
}

function decode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * Starts serving `root`; resolves to the listening http.Server. `proxy(req,
 * res)`, when given, answers every request that is not GET or HEAD.
 * @param {{
 *   root: string,
 *   port?: number,
 *   host?: string,
 *   proxy?: (req: import("node:http").IncomingMessage,
 *     res: import("node:http").ServerResponse) => unknown,
 * }} opts
 */
export async function startLocalServer({
  root,
  port = LOCAL_PORT,
  host = "127.0.0.1",
  proxy = undefined,
}) {
  const siteRoot = path.resolve(root);
  const rules = parseHeaders(
    await fs.readFile(path.join(siteRoot, "_headers"), "utf8").catch(() => ""),
  );

  // A file inside the site, or null. Never _headers itself (Pages hides it)
  // and never anything outside the root.
  async function read(rel) {
    const file = path.resolve(siteRoot, rel);
    if (!file.startsWith(siteRoot + path.sep)) return null;
    if (file === path.join(siteRoot, "_headers")) return null;
    try {
      return { file, body: await fs.readFile(file) };
    } catch {
      return null;
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const send = (status, headers, body) => {
      res.writeHead(status, { ...headersFor(rules, url.pathname), ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (proxy) return proxy(req, res);
      return send(405, { allow: "GET, HEAD" }, "method not allowed");
    }
    const p = decode(url.pathname);
    if (p === null) return send(400, {}, "bad path");
    const rel = p.replace(/^\/+/, "");

    let hit = null;
    if (rel === "" || rel.endsWith("/")) hit = await read(rel + "index.html");
    else if (path.extname(rel)) hit = await read(rel);
    else if (await read(rel + "/index.html")) {
      return send(308, { location: url.pathname + "/" + url.search }, "");
    } else hit = await read(rel + ".html");

    let status = 200;
    if (!hit && !path.extname(rel) && (rel === "app" || rel.startsWith("app/")))
      hit = await read("app/index.html");
    if (!hit) {
      status = 404;
      hit = await read("404.html");
      if (!hit) return send(404, { "content-type": CONTENT_TYPES[".txt"] }, "");
    }
    const type =
      CONTENT_TYPES[path.extname(hit.file).toLowerCase()] ??
      "application/octet-stream";
    const cache = url.pathname.startsWith("/_next/static/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    send(status, { "content-type": type, "cache-control": cache }, hit.body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [root, port] = process.argv.slice(2);
  if (!root) throw new Error("usage: node local-server.mjs <site dir> [port]");
  await startLocalServer({ root, port: port ? Number(port) : LOCAL_PORT });
  console.log(`Serving ${root} on http://127.0.0.1:${port ?? LOCAL_PORT}/`);
}
