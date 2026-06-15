// Unit tests for the research prompt builder + the shared search-skills layer
// (PER-176). The founder's pain: runs surfaced months-old stories with no
// dates. The fix is one canonical, version-controlled "skills folder" fragment
// injected verbatim into every research session, plus a date-first bullet
// contract. These tests pin that the fragment actually reaches the prompt and
// that its non-negotiable rules are present. Run: pnpm --filter @scout/agent test

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { buildResearchPrompt, researchAndSynthesize } from "../src/research.js";
import { SEARCH_SKILLS, STORY_DATE_RE } from "../src/search-skills.js";

test("the built prompt contains the shared search-skills fragment VERBATIM", () => {
  const prompt = buildResearchPrompt({ topic: "ai", doc: "track ai" });
  // The whole canonical fragment must appear as one contiguous block — this is
  // the "skills folder all the search agents use". If this breaks, the shared
  // layer stopped being injected (or got copy-pasted/edited out of band).
  assert.ok(
    prompt.includes(SEARCH_SKILLS),
    "research prompt must inject SEARCH_SKILLS verbatim",
  );
});

test("THE INVARIANT: the interest's doc is injected into the prompt VERBATIM", () => {
  // The whole epic turns on this (PER-139/PER-171): the per-interest intent doc
  // MUST reach the actual research prompt byte-for-byte. If editing a doc doesn't
  // change the next run's prompt, the control is dead. A distinctive body proves
  // it's the doc — not the topic or the shared skills — that landed.
  const doc = [
    "# ai",
    "",
    "Only Anthropic + OpenAI MODEL RELEASES. ZZ_UNIQUE_DOC_MARKER_42.",
    "Ignore funding-round and exec-shuffle noise.",
  ].join("\n");
  const prompt = buildResearchPrompt({ topic: "ai", doc });
  assert.ok(
    prompt.includes(doc),
    "research prompt must inject the interest's doc verbatim",
  );
  // And the composition order holds: shared skills BEFORE the doc, doc BEFORE
  // the date anchor (HOW to research → WHAT to research → recency anchor).
  const skillsAt = prompt.indexOf(SEARCH_SKILLS);
  const docAt = prompt.indexOf("ZZ_UNIQUE_DOC_MARKER_42");
  const dateAt = prompt.indexOf("Today's date is");
  assert.ok(skillsAt >= 0 && docAt >= 0 && dateAt >= 0);
  assert.ok(skillsAt < docAt, "search skills must precede the doc");
  assert.ok(docAt < dateAt, "the doc must precede the date anchor");
});

test("the search-skills fragment enforces the recency + date + sourcing rules", () => {
  // Recency window and the explicit widen-with-a-note rule.
  assert.match(SEARCH_SKILLS, /LAST 7 DAYS/);
  assert.match(SEARCH_SKILLS, /LAST 30 DAYS/);
  assert.match(SEARCH_SKILLS, /showing older items/);
  assert.match(SEARCH_SKILLS, /NEVER silently present months-old/i);
  // Mandatory per-story publish date, captured as a field.
  assert.match(SEARCH_SKILLS, /publish date/i);
  assert.match(SEARCH_SKILLS, /NEWEST FIRST/);
  // Source quality + dedupe.
  assert.match(SEARCH_SKILLS, /primary/i);
  assert.match(SEARCH_SKILLS, /[Dd]eduplicate|dedupe/);
});

test("STORY_DATE_RE extracts the date token from a model-shaped story bullet", () => {
  // A bullet exactly as the fragment specifies. The renderer parses this same
  // token into Article.publishedAt — keep both in sync.
  const dated = "- `2026-06-01` — Acme shipped a thing.";
  const undated = "- `undated` — provenance unclear.";
  assert.equal(STORY_DATE_RE.exec(dated)?.[1], "2026-06-01");
  assert.equal(STORY_DATE_RE.exec(undated)?.[1], "undated");
  // `undated` is the explicit fallback the fragment mandates (never drop the marker).
  assert.match(SEARCH_SKILLS, /`undated`/);
});

test("today's date is injected as a recency anchor", () => {
  const prompt = buildResearchPrompt(
    { topic: "ai", doc: "track ai" },
    new Date("2026-06-02T12:00:00Z"),
  );
  assert.match(prompt, /Today's date is 2026-06-02/);
});

test("the prompt scopes the session to the single topic and its output section", () => {
  const prompt = buildResearchPrompt({ topic: "claude code", doc: "track claude code" });
  // Single-interest session: the topic appears as the session scope and as the
  // exactly-one `## <topic>` output section the assembler later extracts.
  assert.match(prompt, /single topic: "claude code"/);
  assert.match(prompt, /## claude code/);
  // The empty-topic marker is still mandated so coverage stays honest.
  assert.match(prompt, /_no fresh news_/);
});

test("the prompt asks for a bold lead paragraph followed by deeper detail", () => {
  const prompt = buildResearchPrompt({ topic: "ai", doc: "track ai" });

  assert.match(prompt, /FIRST paragraph/i);
  assert.match(prompt, /1[-–]2 sentences/i);
  assert.match(prompt, /bold/i);
  assert.match(prompt, /follow[- ]on paragraphs/i);
  assert.match(prompt, /insight|analysis|implication/i);
});

// A `claude` stub that NEVER closes — models a hung session (model stall /
// network wedge / a rate-limit retry that never returns). Records whether the
// timeout path killed it. This is the PER-181 regression: before the per-session
// timeout, a single hung session blocked the whole sequential run loop forever
// and the brief stayed `pending` indefinitely.
function makeHangingSpawn() {
  const state = { killed: false, killSignal: "" };
  const spawnFn = ((_bin: string, _args: readonly string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
      kill: (sig?: string) => boolean;
    };
    child.pid = undefined; // skip os.setPriority in the stub.
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig?: string) => {
      state.killed = true;
      state.killSignal = sig ?? "";
      return true;
    };
    child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    // Intentionally never emit "close" or "error": the session hangs.
    return child;
  }) as unknown as typeof spawn;
  return { state, spawnFn };
}

test("PER-181: a hung claude session is killed and rejects after the timeout", async () => {
  const { state, spawnFn } = makeHangingSpawn();
  await assert.rejects(
    researchAndSynthesize(
      { topic: "ai", doc: "track ai" },
      { spawnFn, timeoutMs: 50 },
    ),
    /timed out after 50ms/,
    "a session that never closes must reject with a timeout, not hang forever",
  );
  assert.equal(state.killed, true, "the hung child must be killed on timeout");
  assert.equal(state.killSignal, "SIGTERM", "kill should start with SIGTERM");
});

test("PER-181: a session that closes in time is NOT affected by the timeout", async () => {
  // A fast, well-behaved stub still resolves normally — the timeout is a ceiling,
  // not a delay.
  const spawnFn = ((_bin: string, _args: readonly string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    child.stdin.on("finish", () =>
      setImmediate(() => {
        child.stdout.emit(
          "data",
          Buffer.from("## ai\n- a thing.\n  [src](https://example.com/a)\n"),
        );
        child.emit("close", 0);
      }),
    );
    return child;
  }) as unknown as typeof spawn;

  const md = await researchAndSynthesize(
    { topic: "ai", doc: "track ai" },
    { spawnFn, timeoutMs: 5000 },
  );
  assert.match(md, /## ai/);
});
