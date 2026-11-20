// Fills the {{...}} slots in a built site's _headers (public/_headers, copied
// to out/ by the build): the Supabase and Worker origins the app may call,
// and a sha256 hash of each inline script in the built pages. Hashes instead
// of 'unsafe-inline': Next's static export writes a few inline scripts per
// page (the theme bootstrap and the RSC payload), and they change with every
// build, so they are hashed here, after the build, before the deploy.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(path);
    return e.name.endsWith(".html") ? [path] : [];
  });
}

export function inlineScriptHashes(outDir) {
  const hashes = new Set();
  for (const file of htmlFiles(outDir)) {
    for (const [, body] of readFileSync(file, "utf8").matchAll(
      INLINE_SCRIPT_RE,
    )) {
      if (!body) continue;
      const digest = createHash("sha256").update(body).digest("base64");
      hashes.add(`'sha256-${digest}'`);
    }
  }
  return [...hashes].sort();
}

/** Writes outDir/_headers with every slot filled; `worker` may be empty. */
export function fillHeaders(outDir, { supabase, worker }) {
  const file = join(outDir, "_headers");
  const filled = readFileSync(file, "utf8")
    .replace("{{SCRIPT_HASHES}}", inlineScriptHashes(outDir).join(" "))
    .replace("{{SUPABASE_ORIGIN}}", new URL(supabase).origin)
    .replace(" {{WORKER_ORIGIN}}", worker ? ` ${new URL(worker).origin}` : "");
  if (filled.includes("{{")) throw new Error(`${file}: unfilled slot`);
  writeFileSync(file, filled);
}
