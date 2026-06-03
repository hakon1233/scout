// End-to-end contract for the focused-retry path (PER-154).
//
// The founder's bug: a brief came back with some topics dropped, and the Retry
// affordance re-ran the WHOLE prompt and reproduced the same drop, so it never
// recovered. The fix:
//   1. The companion computes per-topic coverage and returns it on the brief, so
//      the UI knows which topics are genuinely missing (vs empty).
//   2. POST /v0/interests accepts `retry_topics` — re-research ONLY that subset
//      and MERGE the fresh sections into the prior brief, leaving the topics that
//      already worked untouched.
//
// This test drives a stub `claude` that DROPS one topic on the first full run,
// then returns it on the focused retry, and asserts the merged brief covers all
// topics. Hermetic: no real claude, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import {
  saveState,
  newPairingToken,
  type Brief,
  type TopicCoverage,
} from "../src/state.js";
import { startServer } from "../src/server.js";

// A claude stub for the per-interest world (C2/PER-171): each session researches
// ONE topic, so each prompt names a `single topic: "<topic>"`. The stub reads
// that topic and emits exactly that topic's section — EXCEPT for "openai", which
// it DROPS the first time it's asked (the bug: a topic comes back missing) and
// supplies on the second ask (the focused retry recovering it). Headings are
// deliberately title-cased to also prove normalized matching survives the
// extract/assemble re-labelling.
function makeTopicAwareSpawn() {
  const calls: Array<{ stdin: string }> = [];
  let openaiSeen = 0;

  const sectionFor = (topic: string): string => {
    const titled = topic.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${titled}\n- ${topic} happened.\n  [example.com — ${titled}](https://example.com/${encodeURIComponent(topic)})\n`;
  };

  const spawnFn = ((_bin: string, _args: readonly string[], _options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    let stdinData = "";
    const record = { stdin: "" };
    calls.push(record);

    const finish = () => {
      record.stdin = stdinData;
      const topic = /single topic: "([^"]+)"/.exec(stdinData)?.[1] ?? "";
      let md = "";
      if (topic === "openai") {
        openaiSeen += 1;
        // First ask (full run) → drop it: emit nothing so the session yields no
        // section and the topic lands as "missing". Second ask (retry) → supply it.
        md = openaiSeen === 1 ? "" : `# Your brief\n\n${sectionFor("openai")}`;
      } else if (topic) {
        md = `# Your brief\n\n${sectionFor(topic)}`;
      }
      child.stdout.emit("data", Buffer.from(md));
      child.emit("close", 0);
    };

    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        stdinData += chunk.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => setImmediate(finish));
    return child;
  }) as unknown as typeof spawn;

  return { calls, spawnFn };
}

async function seededServer() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-retry-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);
  return { tmp, stateFile, token };
}

type BriefWithTopics = Brief & { topics?: TopicCoverage[] };

test("retry_topics re-researches only the dropped topic and merges it in (PER-154)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { calls, spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };

  // Sequence onSynthesisDone resolutions so we can await each run's landing.
  let resolveNext: ((b: Brief) => void) | null = null;
  const nextDone = () =>
    new Promise<Brief>((r) => {
      resolveNext = r;
    });
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveNext?.(b),
  });

  const interests = ["startup news", "ai", "anthropic", "openai"];

  try {
    // ---- Full run: openai is dropped by the model. ----
    let done = nextDone();
    const kick1 = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests }),
    });
    assert.equal(kick1.status, 202);
    await done;

    let res = await fetch(`http://127.0.0.1:${port}/v0/briefs`, { headers: auth });
    let brief = ((await res.json()) as { briefs: BriefWithTopics[] }).briefs[0];
    assert.equal(brief.status, "ready");
    // Coverage is returned and correctly flags openai as missing, the rest covered.
    const byTopic = new Map(brief.topics?.map((t) => [t.topic, t.status]));
    assert.equal(byTopic.get("startup news"), "covered");
    assert.equal(byTopic.get("ai"), "covered");
    assert.equal(byTopic.get("anthropic"), "covered");
    assert.equal(byTopic.get("openai"), "missing");
    const baseMd = brief.summary_md ?? "";

    // ---- Focused retry: only openai. ----
    done = nextDone();
    const kick2 = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests, retry_topics: ["openai"] }),
    });
    assert.equal(kick2.status, 202);
    await done;

    res = await fetch(`http://127.0.0.1:${port}/v0/briefs`, { headers: auth });
    brief = ((await res.json()) as { briefs: BriefWithTopics[] }).briefs[0];
    assert.equal(brief.status, "ready");

    // Every topic is now covered — the retry recovered openai AND preserved the
    // others (they weren't re-researched, just carried over from the base).
    assert.deepEqual(
      brief.topics?.map((t) => t.status),
      ["covered", "covered", "covered", "covered"],
    );
    const mergedMd = brief.summary_md ?? "";
    assert.match(mergedMd, /^##\s+Openai/im);
    // The base sections survived the merge verbatim.
    assert.match(mergedMd, /^##\s+Startup News/im);
    assert.match(mergedMd, /^##\s+Anthropic/im);

    // Per-interest sessions: the full run spawned one per topic (4), the focused
    // retry spawned exactly one more — for openai ONLY — proving we didn't
    // re-spend the whole brief. The first four prompts cover the four topics in
    // order; the fifth (retry) is openai and carries no other topic.
    assert.equal(calls.length, 5);
    assert.match(calls[0].stdin, /single topic: "startup news"/);
    assert.match(calls[3].stdin, /single topic: "openai"/);
    const retryPrompt = calls[4].stdin;
    assert.match(retryPrompt, /single topic: "openai"/);
    assert.doesNotMatch(retryPrompt, /single topic: "anthropic"/);
    assert.notEqual(baseMd, mergedMd);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("retry_topics with no prior brief is refused with a clear error (PER-154)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { spawnFn } = makeTopicAwareSpawn();
  const auth = { authorization: `Bearer ${token}` };
  const { server, port } = await startServer(0, { stateFile, spawnFn });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["openai"], retry_topics: ["openai"] }),
    });
    // No base brief to merge into → 409 with an actionable message, not a
    // silent no-op (no dead controls, PER-139).
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /no base brief/i);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
