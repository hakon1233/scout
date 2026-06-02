// Single-shot research + synthesis via the local `claude` CLI.
//
// Instead of calling a third-party search API and then asking a model to
// summarize, we hand the whole pipeline to a headless `claude` subprocess
// with WebSearch + WebFetch tools enabled. The model picks queries, reads
// pages, and writes the brief directly.
//
// We never read or forward the user's `sk-ant-oat01-…` OAuth token — the
// `claude` binary handles its own auth from `~/.claude/credentials.json`.

import { spawn } from "node:child_process";
import os from "node:os";
import { SEARCH_SKILLS } from "./search-skills.js";

// Read and Write are intentionally excluded — a research subprocess has no
// legitimate reason to access or modify the local filesystem.
const ALLOWED_TOOLS = "WebSearch,WebFetch";

// Run the synthesis child at a lower scheduling priority than the loopback
// server. The `claude` agent is CPU-heavy (web search + fetch + a full model
// loop) and, on a constrained machine, can starve our single-threaded event
// loop so that GET /v0/briefs and /healthz stop responding mid-synthesis —
// the UI then sees its polling stall (PER-101). Niceness is advisory: it only
// costs `claude` cycles when something else (us, answering a poll) actually
// wants the CPU, so it doesn't slow synthesis on an idle box. Increasing
// niceness is always permitted for unprivileged processes; we swallow the
// rare EPERM/ENOSYS rather than fail the run.
const SYNTH_CHILD_NICENESS = 10;

export type ResearchOptions = {
  claudeBin?: string;
  // Spawn override for tests — lets us inject a stub `claude` without hitting
  // the real binary or network.
  spawnFn?: typeof spawn;
};

export async function researchAndSynthesize(
  interests: string[],
  opts: ResearchOptions = {},
): Promise<string> {
  const claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ?? "claude";
  const spawnImpl = opts.spawnFn ?? spawn;
  const prompt = buildResearchPrompt(interests);

  return await new Promise<string>((resolve, reject) => {
    const child = spawnImpl(
      claudeBin,
      [
        "--print",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
        "--allowed-tools",
        ALLOWED_TOOLS,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    // De-prioritize the heavy child so it can't starve the loopback server.
    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, SYNTH_CHILD_NICENESS);
      } catch {
        // Not fatal — synthesis still runs, just without the niceness hedge.
      }
    }

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) =>
      reject(
        new Error(
          `failed to spawn '${claudeBin}' — is the Claude Code CLI installed and on PATH? (${e.message})`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
      const text = stripBriefPreamble(stdout);
      if (!text) return reject(new Error("claude returned empty output"));
      resolve(text);
    });

    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}

// Strip the `claude` CLI's conversational lead-in before the actual brief.
//
// Even with "No preamble" in the prompt, the headless `claude` run sometimes
// emits a meta sentence first — e.g. "I have enough to write the brief." —
// which then leaks into the rendered brief (PER-113 #1). The brief itself is
// required to start with the `# Your brief` H1, so the robust fix is: if any
// markdown heading exists, drop everything before the first one. Fallback for
// the (rare) headingless case: drop a single leading non-bullet paragraph.
export function stripBriefPreamble(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // Primary path: slice from the first markdown heading line (`# `, `## `, …).
  const headingMatch = text.match(/^#{1,6}\s/m);
  if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
    return text.slice(headingMatch.index).trim();
  }
  if (headingMatch) return text; // already starts at the heading — nothing to strip.

  // Fallback: no heading at all. If the first paragraph is plain prose (not a
  // list item or citation) and more content follows, treat it as preamble.
  const paras = text.split(/\n\s*\n/);
  if (paras.length > 1 && !/^\s*[-*]\s|\]\(/.test(paras[0])) {
    return paras.slice(1).join("\n\n").trim();
  }
  return text;
}

export function buildResearchPrompt(interests: string[], now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD, anchors "last 7 days".
  const lines: string[] = [];
  lines.push("You are Scout, an agent that researches and writes a personalized news brief.");
  lines.push("");
  lines.push(`Today's date is ${today}. Use it to judge how recent each item is.`);
  lines.push("");
  lines.push("Use the WebSearch tool to find news on each topic below. Use WebFetch on the");
  lines.push("most promising results per topic to confirm the facts AND the publish date,");
  lines.push("so you write a real summary (not a headline rehash) with a verified date.");
  lines.push("");
  // The shared "skills folder" — one canonical, version-controlled fragment
  // (search-skills.ts) injected into EVERY research session. Defines recency,
  // mandatory per-story dates, source quality, and the date-first bullet format.
  lines.push(SEARCH_SKILLS);
  lines.push("");
  lines.push("Topics the reader picked:");
  for (const t of interests) lines.push(`- ${t}`);
  lines.push("");
  lines.push("Output requirements:");
  lines.push("- GitHub-flavored Markdown only. No preamble, no trailing commentary.");
  lines.push("- Start with `# Your brief`.");
  lines.push("- EXACTLY one `## <topic>` section for EVERY topic above, in the same");
  lines.push("  order. Never merge, skip, rename, or combine topics — even closely");
  lines.push("  related ones (e.g. keep `anthropic`, `claude code`, and `openai` as");
  lines.push("  separate sections). The heading text must be the topic VERBATIM as");
  lines.push("  written above (same words; capitalization may differ).");
  lines.push("- Under each topic, 2-4 story bullets following the date-first format and");
  lines.push("  recency rules in the search skills above (newest first, ISO date in");
  lines.push("  backticks leading each bullet, citation on the next line).");
  lines.push("- If you genuinely can't find anything within the last 30 days for a topic,");
  lines.push("  STILL emit its `## <topic>` heading with a single line `_no fresh news_`");
  lines.push("  underneath — never omit the section.");
  lines.push("- Keep the whole brief under ~500 words.");
  lines.push("");
  lines.push("Write the brief now.");
  return lines.join("\n");
}
