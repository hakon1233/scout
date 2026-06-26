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

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

// Map a request pathname to the candidate files to try, in order. Mirrors the
// Next export layout: directory routes resolve to their index.html; an
// extensionless path also tries `<path>.html`.
function candidatesFor(pathname: string): string[] {
  // Strip leading slash; default root to index.html.
  const decoded = decodePathname(pathname);
  if (decoded === null) return [];
  const p = decoded.replace(/^\/+/, "");
  if (p === "") return ["index.html"];
  if (p.endsWith("/")) return [p + "index.html"];
  if (path.extname(p)) return [p];
  return [p + "/index.html", p + ".html"];
}

// Path-traversal containment guard: a resolved candidate is safe only when it
// is `root` itself or sits strictly beneath it. Shared by every file-system
// resolver below so the security predicate can't drift between call sites.
function isInsideRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root + path.sep);
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
    if (!isInsideRoot(filePath, root)) continue;
    try {
      const body = await fs.readFile(filePath);
      return { filePath, contentType: contentTypeFor(filePath), body };
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Canonical trailing-slash redirect target for an extensionless directory
// route, or null. The Next export uses `trailingSlash: true`, so GitHub Pages
// 301s `/app/connect` → `/app/connect/`. The companion's file server would
// otherwise serve the page directly at the non-canonical URL (200), a cosmetic
// origin mismatch (PER-127). Only redirects when the directory's index.html
// actually exists, so genuinely-missing routes still fall through to the SPA
// fallback / 404 instead of bouncing to a slashed dead-end.
export async function trailingSlashRedirect(
  pathname: string,
  root: string = WEBROOT,
): Promise<string | null> {
  if (!(await hasWebroot(root))) return null;
  const p = decodePathname(pathname);
  if (p === null) return null;
  if (p === "/" || p.endsWith("/") || path.extname(p)) return null;
  const rel = p.replace(/^\/+/, "") + "/index.html";
  const filePath = path.resolve(root, rel);
  if (!isInsideRoot(filePath, root)) return null;
  try {
    await fs.access(filePath);
    return pathname + "/";
  } catch {
    return null;
  }
}

// SPA fallback: serve the `/app/` shell for an unmatched, extensionless
// navigation under `/app` so a deep-link or refresh of an in-app view
// (e.g. /app/settings) lands on the app instead of a hard 404 (PER-127).
// In-app views like settings are panels rendered at `/app/`, not real export
// routes, so there is no `/app/settings/index.html` to serve. Extensionless +
// `/app`-scoped is deliberate: asset misses (have extensions) and unknown
// top-level routes still 404.
export async function resolveAppShellFallback(
  pathname: string,
  root: string = WEBROOT,
): Promise<StaticHit | null> {
  const decoded = decodePathname(pathname);
  if (decoded === null) return null;
  const p = decoded.replace(/^\/+/, "");
  if (path.extname(p)) return null;
  if (p !== "app" && !p.startsWith("app/")) return null;
  return resolveStatic("/app/", root);
}
