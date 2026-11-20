import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// UI helpers that were copied file to file live in one module each. A copy
// that comes back fails here: the intent doc markdown map (DocMarkdown.tsx),
// formatDocDate (lib/format-date.ts), SkeletonLine (ui/Skeleton.tsx) and the
// chat card's line diff (ChatActionCard.tsx's DiffLines).

const SRC = path.resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const HOMES: Array<[RegExp, string]> = [
  [
    /^(export )?const (MD|\w*MARKDOWN\w*) = \{/m,
    "components/profile/DocMarkdown.tsx",
  ],
  [/function formatDocDate\b/, "lib/format-date.ts"],
  [/function SkeletonLine\b/, "components/ui/Skeleton.tsx"],
];

test("each shared UI helper is defined in one module", () => {
  const files = sources(SRC);
  for (const [pattern, home] of HOMES) {
    const defining = files
      .filter((f) => pattern.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    assert.deepEqual(defining, [home], String(pattern));
  }
});

test("the chat cards draw their line diff once", () => {
  const card = readFileSync(
    path.join(SRC, "components/profile/ChatActionCard.tsx"),
    "utf8",
  );
  assert.equal(card.split("diff.map(").length - 1, 1);
});
