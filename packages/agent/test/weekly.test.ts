import test from "node:test";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadState, newPairingToken, saveState } from "../src/state.js";
import type { Brief } from "../src/contract.js";
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

test("buildWeeklyBrief dedupes URLs that differ only by query/hash/trailing slash", () => {
  // Same story cited across two days: once clean, once with a tracking query
  // param and a trailing slash. The web app keys likes + feed dedupe on the
  // canonical URL (src/lib/likes.ts), so the weekly digest must collapse these
  // to one item rather than showing the story twice.
  const now = new Date("2026-06-15T12:00:00.000Z");
  const clean = [
    "- `2026-06-14` — OpenAI shipped a new agent release.",
    "  [openai.com — Agent release](https://example.com/agent)",
  ].join("\n");
  const tracked = [
    "- `2026-06-13` — Same agent release, re-cited with tracking params.",
    "  [blog.example — Agent rewrite](https://example.com/agent/?utm_source=newsletter#top)",
  ].join("\n");
  const history: Brief[] = [
    dailyBrief("latest", "2026-06-15T07:00:00.000Z", "AI", [clean]),
    dailyBrief("older", "2026-06-14T07:00:00.000Z", "AI", [tracked]),
  ];

  const weekly = buildWeeklyBrief(history, now);

  const occurrences =
    (weekly.summary_md ?? "").match(/example\.com\/agent/g) ?? [];
  assert.equal(occurrences.length, 1);
  // The newest run's citation wins the dedupe.
  assert.match(weekly.summary_md ?? "", /OpenAI shipped a new agent release/);
  assert.doesNotMatch(weekly.summary_md ?? "", /re-cited with tracking params/);
});

test("buildWeeklyBrief drops stale stories inside otherwise eligible daily briefs", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const staleStoryInRecentBrief = [
    "- `2026-05-01` — A stale item got through a recent daily brief.",
    "  [old.example — Stale](https://example.com/stale-in-recent)",
  ].join("\n");
  const history: Brief[] = [
    dailyBrief("latest", "2026-06-15T07:00:00.000Z", "AI", [
      storyA,
      staleStoryInRecentBrief,
    ]),
  ];

  const weekly = buildWeeklyBrief(history, now);

  assert.match(weekly.summary_md ?? "", /OpenAI shipped a new agent release/);
  assert.doesNotMatch(weekly.summary_md ?? "", /stale item got through/);
  assert.doesNotMatch(weekly.summary_md ?? "", /stale-in-recent/);
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

// The same feature-complete brief the web app's parser is pinned on. The
// expected digest is recorded from the current implementation.
const FULL_BRIEF =
  [
    "Intro prose with a [loose citation](https://example.com/loose).",
    "",
    "# Your brief",
    "",
    "## AI agents",
    "_Nothing notable in the last week — showing older items._",
    "- `2026-09-30` — **OpenAI** ships a new [agents SDK](https://example.com/inline) for tools.",
    "  [example.com — Agents SDK released](https://example.com/agents?utm_source=x)",
    "  ![source image](https://cdn.example.com/img%20(13).png)",
    "  > Lead paragraph about the SDK.",
    "  >",
    "  > Second paragraph with a [body link](https://example.com/body-only).",
    "- `undated` — An undated item.",
    "  [other.org — Undated piece](https://other.org/undated/)",
    "* `2026-09-28` — Star bullet with two sources.",
    "  [a.com — First](https://a.com/1) and [b.com — Second](https://b.com/2)",
    "- No date marker at all.",
    "  ![source image](https://cdn.example.com/only-image.png)",
    "",
    "## Climate tech",
    "_no fresh news_",
    "",
    "## Climate tech",
    "- `2026-09-29` – en dash story.",
    "  [c.org — Repeat heading](https://c.org/x)",
  ].join("\n") + "\n";

// The image-only story is left out: it has no citation, so the feed (one
// article per citation) could never show it, yet it took a weekly slot.
test("the weekly digest of a feature-complete brief matches the recorded markdown", () => {
  const weekly = createWeeklyBriefFromHistory(
    [
      {
        id: "b1",
        generated_at: "2026-09-30T08:00:00.000Z",
        status: "ready",
        summary_md: FULL_BRIEF,
      },
    ],
    new Date("2026-10-01T12:00:00.000Z"),
  );
  assert.equal(
    weekly.summary_md,
    "# Weekly brief\n\n## Top stories this week\n- `2026-09-30` — **OpenAI** ships a new [agents SDK](https://example.com/inline) for tools.\n  [example.com — Agents SDK released](https://example.com/agents?utm_source=x)\n  ![source image](https://cdn.example.com/img%20(13).png)\n  > Lead paragraph about the SDK.\n  >\n  > Second paragraph with a [body link](https://example.com/body-only).\n  _From AI agents_\n\n- `undated` — An undated item.\n  [other.org — Undated piece](https://other.org/undated/)\n  _From AI agents_\n\n* `2026-09-28` — Star bullet with two sources.\n  [a.com — First](https://a.com/1) and [b.com — Second](https://b.com/2)\n  _From AI agents_\n\n- `2026-09-29` – en dash story.\n  [c.org — Repeat heading](https://c.org/x)\n  _From Climate tech_",
  );
});

test("POST /v0/weekly-brief answers 409 while a run is in flight and leaves its slot alone", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-weekly-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  await saveState(
    { pairing_token: token, interests: [{ id: "int_ai", topic: "AI" }] },
    stateFile,
  );

  // A research child that answers only when released.
  let respond = () => {};
  let markSpawned = () => {};
  const spawned = new Promise<void>((r) => (markSpawned = r));
  const spawnFn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write: (_c, _e, cb) => cb() });
    respond = () => {
      child.stdout.emit(
        "data",
        Buffer.from(
          "## AI\n- `2026-06-15` — A story.\n  [a.com — A](https://a.com/a)\n",
        ),
      );
      child.emit("close", 0);
    };
    markSpawned();
    return child;
  }) as unknown as typeof spawn;
  let synthesized = () => {};
  const done = new Promise<void>((r) => (synthesized = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: () => synthesized(),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const run = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ interests: ["AI"] }),
    });
    assert.equal(run.status, 202);
    const { brief_id } = (await run.json()) as { brief_id: string };

    const weekly = await fetch(`http://127.0.0.1:${port}/v0/weekly-brief`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(weekly.status, 409);
    const slot = (await loadState(stateFile)).last_brief;
    assert.equal(slot?.id, brief_id);
    assert.equal(slot?.status, "pending");
  } finally {
    await spawned;
    respond();
    await done;
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
