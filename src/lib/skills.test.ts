import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillSet } from "./skills";

test("a wrapped bullet stays prose; only an indented sample becomes detail", () => {
  const set = parseSkillSet(`## Rules

Intro.

FORMAT:
- Put the date first, then a summary, then the citation on
  the next line:
  - \`YYYY-MM-DD\` — summary.
    [domain — Title](url)
- One more rule.`);

  assert.deepEqual(set.groups[0].bullets, [
    {
      text: "Put the date first, then a summary, then the citation on the next line:",
      detail: ["- `YYYY-MM-DD` — summary.", "[domain — Title](url)"],
    },
    { text: "One more rule.", detail: [] },
  ]);
});
