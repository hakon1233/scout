// Offline checks for model output. Each check is one rule from the prompts the
// companion sends (search-skills.ts, research.ts, chat.ts), applied to a
// recorded output with the same parsers the product uses. No model is called.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBrief } from "../src/brief-document.js";
import { applyChatChanges, parseChatOutput } from "../src/chat.js";
import { normalizeTopic } from "../src/coverage.js";
import type { Interest } from "../src/contract.js";

export type Check = { name: string; pass: boolean; detail?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_MARKER_RE = /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`/;

function check(name: string, pass: boolean, detail?: string): Check {
  return pass ? { name, pass } : { name, pass, detail };
}

// One research session's output for one topic.
export function checkResearchOutput(
  raw: string,
  opts: { topic: string; today: string },
): Check[] {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  const { topics, entries } = parseBrief(raw);
  const stories = entries.flatMap((e) => (e.kind === "story" ? [e] : []));
  const noFreshNews = /_+\s*no fresh news\s*_+/i.test(raw);
  const dates = stories.map((s) => DATE_MARKER_RE.exec(s.raw)?.[1] ?? null);
  const dated = dates.filter((d): d is string => d !== null && d !== "undated");
  const todayMs = Date.parse(opts.today);
  const oldest = new Date(todayMs - 30 * DAY_MS).toISOString().slice(0, 10);
  const words = raw.split(/\s+/).filter(Boolean).length;

  return [
    check(
      "no-preamble",
      /^##\s/.test(firstLine),
      `starts with: ${firstLine.slice(0, 60)}`,
    ),
    check(
      "one-section-for-topic",
      topics.length === 1 &&
        normalizeTopic(topics[0]) === normalizeTopic(opts.topic),
      `headings: ${JSON.stringify(topics)}`,
    ),
    check(
      "story-count",
      (stories.length >= 2 && stories.length <= 4) ||
        (stories.length === 0 && noFreshNews),
      `${stories.length} stories`,
    ),
    check(
      "every-story-dated",
      dates.every((d) => d !== null),
      `${dates.filter((d) => d === null).length} without a date marker`,
    ),
    check(
      "newest-first",
      dated.every((d, i) => i === 0 || dated[i - 1] >= d) &&
        dates.every((d, i) => d !== "undated" || i >= dated.length),
      `order: ${dates.join(", ")}`,
    ),
    check(
      "fresh",
      dated.every((d) => d >= oldest && d <= opts.today),
      `outside ${oldest}..${opts.today}: ${dated.filter((d) => d < oldest || d > opts.today).join(", ")}`,
    ),
    check(
      "every-story-cited",
      stories.every((s) => s.links.some((l) => l.label.includes(" — "))),
      `${stories.filter((s) => s.links.length === 0).length} with no citation`,
    ),
    check(
      "in-depth-body",
      stories.every(
        (s) => (s.body?.split("\n\n").filter(Boolean).length ?? 0) >= 4,
      ),
      "every story needs a lead plus at least 3 paragraphs",
    ),
    check(
      "source-images-https",
      stories.every((s) => s.image === null || s.image.startsWith("https://")),
    ),
    check("length", words <= 950, `${words} words`),
  ];
}

// One chat turn's output, applied to a throwaway copy of the interests.
export async function checkChatOutput(
  raw: string,
  opts: {
    interests: Interest[];
    expect: {
      applied: string[];
      pendingDelete?: string;
      pendingRewrite?: string;
    };
  },
): Promise<Check[]> {
  let output: ReturnType<typeof parseChatOutput>;
  try {
    output = parseChatOutput(raw);
  } catch (err) {
    return [check("json-object", false, String(err))];
  }
  const ids = new Set(opts.interests.map((i) => i.id));
  const ops = output.changes.map((c) => c.op);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-eval-"));
  try {
    const result = await applyChatChanges(opts.interests, output.changes, dir);
    const effect = {
      applied: result.applied.map((c) => `${c.op}:${c.topic ?? ""}`),
      pendingDelete: result.pendingDeletes[0]?.topic,
      pendingRewrite: result.pendingRewrites[0]?.topic,
    };
    return [
      check("json-object", true),
      check("reply", output.reply.trim().length > 0),
      check(
        "known-ops",
        ops.every((op) =>
          ["create", "update", "rewrite", "delete"].includes(String(op)),
        ),
        `ops: ${JSON.stringify(ops)}`,
      ),
      check(
        "owned-ids",
        output.changes.every(
          (c) => c.op === "create" || ids.has(String(c.interestId)),
        ),
        "update, rewrite and delete must name a listed interest id",
      ),
      check(
        "expected-effect",
        JSON.stringify(effect) ===
          JSON.stringify({
            applied: opts.expect.applied,
            pendingDelete: opts.expect.pendingDelete,
            pendingRewrite: opts.expect.pendingRewrite,
          }),
        `got ${JSON.stringify(effect)}`,
      ),
    ];
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
