// Single-shot research + synthesis via the local `claude` CLI.
//
// Instead of calling a third-party search API and then asking a model to
// summarize, we hand the whole pipeline to a headless `claude` child that may
// use only WebSearch and WebFetch (see claude-runner.ts). The model picks
// queries, reads pages, and writes the brief section directly.

import type { spawn } from "node:child_process";
import {
  buildResearchPrompt,
  CLI_RESEARCH_TOOLS,
  stripBriefPreamble,
  type ResearchInterest,
} from "#core";
import { runClaude } from "./claude-runner.js";

export type ResearchOptions = {
  claudeBin?: string;
  // Test seam: a stub `claude` without the real binary or network.
  spawnFn?: typeof spawn;
  // Per-session hard timeout in ms; defaults to SCOUT_SESSION_TIMEOUT_MS or 4 min.
  timeoutMs?: number;
  // Caps for a budgeted session (the Scout team runner): the search and fetch
  // budget the prompt states, and the CLI's `--max-turns` as the hard stop.
  maxSearches?: number;
  maxTurns?: number;
};

// Research a SINGLE interest in its own headless `claude` session with only
// WebSearch and WebFetch. Each interest gets its own session so the doc that
// scopes WHAT to look for reaches the model. Returns the session's
// preamble-stripped markdown; the runner extracts the topic's section and
// assembles the full brief across interests.
export async function researchAndSynthesize(
  interest: ResearchInterest,
  opts: ResearchOptions = {},
): Promise<string> {
  const prompt = buildResearchPrompt(interest, new Date(), CLI_RESEARCH_TOOLS, {
    maxSearches: opts.maxSearches,
  });
  const raw = await runClaude(prompt, {
    tools: "web-research",
    label: `claude session for "${interest.topic}"`,
    claudeBin: opts.claudeBin,
    spawnFn: opts.spawnFn,
    timeoutMs: opts.timeoutMs,
    maxTurns: opts.maxTurns,
  });
  const text = stripBriefPreamble(raw);
  if (!text) throw new Error("claude returned empty output");
  return text;
}
