// The seams around the web app and @scout/core: the app imports shared code
// only from @scout/core (never the companion's modules or the server-side
// @scout/research and @scout/worker), and the core stays pure, importing nothing outside its own
// folder, so it is safe in a browser, in Node and in Deno.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Static imports and re-exports (`import … from`, `export … from`, a bare
// `import "x"`) and dynamic `import("x")`.
const IMPORT_SPEC =
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT_SPEC)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

test("the web app imports no companion or server-side module", () => {
  const offenders = sourceFiles("src").flatMap((file) =>
    importsOf(file)
      .filter((spec) =>
        /@scout\/(agent|research|worker)|packages\/(agent|core|research|worker)/.test(
          spec,
        ),
      )
      .map((spec) => `${file}: ${spec}`),
  );
  assert.deepEqual(offenders, []);
});

test("@scout/core imports only its own modules", () => {
  const offenders = sourceFiles("packages/core/src").flatMap((file) =>
    importsOf(file)
      .filter((spec) => !/^\.\/[\w-]+\.ts$/.test(spec))
      .map((spec) => `${file}: ${spec}`),
  );
  assert.deepEqual(offenders, []);
});
