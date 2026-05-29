// Minimal, dependency-free static file server for the bundled Scout web UI.
//
// The companion serves the prebuilt Next static export (`webroot/`) from its
// own loopback origin (http://127.0.0.1:47821/). Because the page is then
// SAME-ORIGIN with the companion API, the browser's Local Network Access (LNA)
// gate never engages — there is no public→loopback transition, so no "Allow
// local network" permission prompt. See server.ts for the full PNA/LNA story.
//
// The export is produced with `output: "export"` + `trailingSlash: true` and an
// empty basePath, so routes look like `/`, `/app/`, `/app/connect/`, each
// backed by an `index.html`, plus hashed assets under `/_next/`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/static.js → packages/agent/webroot. In dev (tsx src/static.ts) this
// resolves to packages/agent/src/../webroot, which simply won't exist — the
// server then 404s static routes and keeps the API working.
export const WEBROOT = path.resolve(__dirname, "..", "webroot");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export async function hasWebroot(root: string = WEBROOT): Promise<boolean> {
  try {
    const st = await fs.stat(root);
    return st.isDirectory();
  } catch {
    return false;
  }
}

// Map a request pathname to the candidate files to try, in order. Mirrors the
// Next export layout: directory routes resolve to their index.html; an
// extensionless path also tries `<path>.html`.
function candidatesFor(pathname: string): string[] {
  // Strip leading slash; default root to index.html.
  let p = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (p === "") return ["index.html"];
  if (p.endsWith("/")) return [p + "index.html"];
  if (path.extname(p)) return [p];
  return [p + "/index.html", p + ".html"];
}

export type StaticHit = { filePath: string; contentType: string; body: Buffer };

// Resolve and read the static file for a pathname, or null if none matches.
// Guards against path traversal: every candidate must resolve inside `root`.
// `root` is injectable for tests; production uses the bundled WEBROOT.
export async function resolveStatic(
  pathname: string,
  root: string = WEBROOT,
): Promise<StaticHit | null> {
  if (!(await hasWebroot(root))) return null;
  for (const rel of candidatesFor(pathname)) {
    const filePath = path.resolve(root, rel);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) continue;
    try {
      const body = await fs.readFile(filePath);
      return { filePath, contentType: contentTypeFor(filePath), body };
    } catch {
      // try next candidate
    }
  }
  return null;
}
