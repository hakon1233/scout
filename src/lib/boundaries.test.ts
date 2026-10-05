// The seam between the web app and the companion: the app may import only the
// companion modules that are safe in a browser, and those import nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const BROWSER_SAFE = [
  "contract",
  "brief-document",
  "search-skills",
  "assembly-skills",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test("the web app imports only browser-safe companion modules", () => {
  const offenders = sourceFiles("src").flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /(?:from|import)\s*\(?\s*["'](@scout\/agent\/[^"']+|[./]+packages\/agent[^"']*)["']/g,
      ),
    ]
      .map((m) => m[1])
      .filter((spec) => !BROWSER_SAFE.some((m) => spec === `@scout/agent/${m}`))
      .map((spec) => `${file}: ${spec}`),
  );
  assert.deepEqual(offenders, []);
});

test("browser-safe companion modules import nothing", () => {
  for (const name of BROWSER_SAFE) {
    const source = readFileSync(`packages/agent/src/${name}.ts`, "utf8");
    assert.doesNotMatch(
      source,
      /^\s*import[\s{*"']|^\s*export\s[^;]*\sfrom\s*["']|\bimport\s*\(/m,
      `${name}.ts has an import`,
    );
  }
});
