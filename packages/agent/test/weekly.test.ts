import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadState,
  newPairingToken,
  saveState,
  type Brief,
} from "../src/state.js";
import {
  buildWeeklyBrief,
  createWeeklyBriefFromHistory,
} from "../src/weekly.js";
import { startServer } from "../src/server.js";

function dailyBrief(
  id: string,
  generatedAt: string,
  topic: string,
  items: string[],
): Brief {
  return {
    id,
    generated_at: generatedAt,
    status: "ready",
    kind: "daily",
    summary_md: `# Your brief\n\n## ${topic}\n${items.join("\n")}`,
  };
}

const storyA = [
  "- `2026-06-14` — OpenAI shipped a new agent release.",
  "  [openai.com — Agent release](https://example.com/agent)",
  "  > Useful detail.",
].join("\n");
const storyADupe = [
  "- `2026-06-13` — Another outlet rewrote the same agent release.",
  "  [blog.example — Agent rewrite](https://example.com/agent)",
].join("\n");
const storyB = [
  "- `2026-06-12` — Anthropic published an evals update.",
  "  [anthropic.com — Evals](https://example.com/evals)",
].join("\n");
const storyOld = [
  "- `2026-05-01` — Old funding news.",
  "  [old.example — Funding](https://example.com/old)",
].join("\n");

test("buildWeeklyBrief pools the last 7 days, dedupes by URL, and caps top stories", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const history: Brief[] = [
    dailyBrief("latest", "2026-06-15T07:00:00.000Z", "AI", [storyA, storyB]),
    dailyBrief("older", "2026-06-13T07:00:00.000Z", "AI", [storyADupe]),
    dailyBrief("too-old", "2026-06-01T07:00:00.000Z", "Startups", [storyOld]),
  ];

  const weekly = buildWeeklyBrief(history, now);

  assert.equal(weekly.kind, "weekly");
  assert.equal(weekly.status, "ready");
  assert.match(weekly.summary_md ?? "", /^# Weekly brief/m);
  assert.match(weekly.summary_md ?? "", /## Top stories this week/);
  assert.match(weekly.summary_md ?? "", /OpenAI shipped a new agent release/);
  assert.match(weekly.summary_md ?? "", /Anthropic published an evals update/);
  assert.doesNotMatch(weekly.summary_md ?? "", /Another outlet rewrote/);
  assert.doesNotMatch(weekly.summary_md ?? "", /Old funding news/);
});

test("POST /v0/weekly-brief persists a weekly brief into history without mutating interests", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-weekly-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  const interests = [{ id: "int_ai", topic: "AI" }];
  await saveState(
    {
      pairing_token: token,
      interests,
      briefs: [
        dailyBrief("latest", "2026-06-15T07:00:00.000Z", "AI", [
          storyA,
          storyB,
        ]),
      ],
    },
    stateFile,
  );

  const { server, port } = await startServer(0, { stateFile });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/weekly-brief`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { brief: Brief };
    assert.equal(body.brief.kind, "weekly");

    const state = await loadState(stateFile);
    assert.equal(state.last_brief?.kind, "weekly");
    assert.equal(state.briefs?.[0]?.id, body.brief.id);
    assert.deepEqual(state.interests, interests);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("createWeeklyBriefFromHistory reports no source material instead of inventing stories", () => {
  const weekly = createWeeklyBriefFromHistory(
    [],
    new Date("2026-06-15T12:00:00.000Z"),
  );

  assert.equal(weekly.kind, "weekly");
  assert.match(weekly.summary_md ?? "", /No eligible daily stories/);
});
