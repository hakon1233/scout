// Offline checks for model output. Each check is one rule from the prompts the
// companion sends (search-skills.ts, research.ts, chat.ts) and the publish
// check (core publish-check.ts), applied to a hand-written example output with
// the same parsers the product uses. No model is called.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyChatChanges } from "../src/chat-changes.js";
import {
  MAX_TAGS,
  normalizeTags,
  normalizeTopic,
  parseBrief,
  parseChatOutput,
  parsePublishCheck,
  type Interest,
  type PublishInput,
} from "#core";

export type Check = { name: string; pass: boolean; detail?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_MARKER_RE = /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`/;

function check(name: string, pass: boolean, detail?: string): Check {
  return pass ? { name, pass } : { name, pass, detail };
}

// The one line a section with no story carries (relevance-skills.ts):
// "No change since YYYY-MM-DD." or "No news yet.", optionally in italics, or
// the intent doc's own "No change…" text.
const EMPTY_LINE_RE = /^\s*_?\s*No (?:change|news)\b/im;
const NO_CHANGE_SINCE_RE = /No change since (\d{4}-\d{2}-\d{2})/i;

// One research session's output for one topic. `lastStory` is the date of the
// topic's last posted story; `past` the titles and URLs already posted.
export function checkResearchOutput(
  raw: string,
  opts: {
    topic: string;
    today: string;
    lastStory?: string;
    past?: string[];
  },
): Check[] {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  const { topics, entries } = parseBrief(raw);
  const stories = entries.flatMap((e) => (e.kind === "story" ? [e] : []));
  const emptyLine = EMPTY_LINE_RE.test(raw);
  const noChangeDate = NO_CHANGE_SINCE_RE.exec(raw)?.[1] ?? null;
  const noNewsYet = /No news yet\./i.test(raw);
  const past = new Set((opts.past ?? []).map((p) => p.toLowerCase()));
  const repeats = stories.filter((s) =>
    s.links.some(
      (l) =>
        past.has(l.url.toLowerCase()) ||
        past.has((l.label.split(" — ")[1] ?? l.label).toLowerCase()),
    ),
  );
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
      (stories.length >= 1 && stories.length <= 4) ||
        (stories.length === 0 && emptyLine),
      `${stories.length} stories`,
    ),
    check(
      "no-change-line",
      (noChangeDate === null || noChangeDate === opts.lastStory) &&
        (!noNewsYet || !opts.lastStory),
      noChangeDate
        ? `says ${noChangeDate}, last story ${opts.lastStory ?? "none"}`
        : "says No news yet. but the topic has posted before",
    ),
    check(
      "novel",
      repeats.length === 0,
      `already posted: ${repeats.map((s) => s.links[0]?.url).join(", ")}`,
    ),
    check(
      "after-last-story",
      !opts.lastStory || dated.every((d) => d >= opts.lastStory!),
      `before ${opts.lastStory}: ${dated.filter((d) => d < (opts.lastStory ?? "")).join(", ")}`,
    ),
    check(
      "no-padding-banner",
      !/showing older items/i.test(raw),
      'the old "showing older items" banner pads a quiet topic',
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
      stories.every((s) => {
        const n = s.body?.split("\n\n").filter(Boolean).length ?? 0;
        return n >= 1 && n <= 3;
      }),
      "every story needs a body of 1-3 paragraphs (the lead first)",
    ),
    check(
      "source-images-https",
      stories.every((s) => s.image === null || s.image.startsWith("https://")),
    ),
    check("length", words <= 700, `${words} words`),
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

// The publish check (core publish-check.ts): one JSON verdict. A good approve
// has 1 to 5 valid tags, at most one outside the seed list; a refuse has no
// tags and one short reason that repeats no full name from the topic.
export function checkPublishOutput(
  output: string,
  ctx: { input: PublishInput; expect: "approve" | "refuse" },
): Check[] {
  type Raw = { verdict?: unknown; reason?: unknown; tags?: unknown };
  const raw = ((): Raw | null => {
    try {
      const parsed: unknown = JSON.parse(output);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Raw)
        : null;
    } catch {
      return null;
    }
  })();
  const checks: Check[] = [check("json-object", raw !== null)];
  const got = parsePublishCheck(output).approved ? "approve" : "refuse";
  checks.push(
    check(
      "verdict",
      raw?.verdict === ctx.expect && got === ctx.expect,
      `expected ${ctx.expect}, got ${String(raw?.verdict)}`,
    ),
  );
  if (raw?.verdict === "approve") {
    const tags: unknown[] = Array.isArray(raw.tags) ? raw.tags : [];
    const kept = normalizeTags(tags, { maxFree: 1 });
    checks.push(
      check(
        "tags",
        tags.length >= 1 &&
          tags.length <= MAX_TAGS &&
          kept.length === tags.length &&
          kept.every((t, i) => t === tags[i]),
        `tags ${JSON.stringify(tags)}; usable ${JSON.stringify(kept)}`,
      ),
    );
  }
  if (raw?.verdict === "refuse") {
    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    const names =
      [ctx.input.displayName ?? "", ctx.input.title, ctx.input.doc]
        .join("\n")
        .match(/[A-ZÆØÅ][a-zæøå]+(?: [A-ZÆØÅ][a-zæøå]+)+/g) ?? [];
    const repeated = names.filter((n) => reason.includes(n));
    const noTags = Array.isArray(raw.tags) && raw.tags.length === 0;
    checks.push(
      check(
        "reason",
        reason.length > 0 &&
          reason.length <= 200 &&
          repeated.length === 0 &&
          noTags,
        !reason
          ? "no reason"
          : repeated.length
            ? `repeats ${repeated.join(", ")}`
            : "too long or has tags",
      ),
    );
  }
  return checks;
}
