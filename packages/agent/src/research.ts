// Single-shot research + synthesis via the local `claude` CLI.
//
// Instead of calling a third-party search API and then asking a model to
// summarize, we hand the whole pipeline to a headless `claude` child that may
// use only WebSearch and WebFetch (see claude-runner.ts). The model picks
// queries, reads pages, and writes the brief section directly.

import type { spawn } from "node:child_process";
import {
  buildMakePrompt,
  buildResearchPrompt,
  CLI_RESEARCH_TOOLS,
  stripBriefPreamble,
  type CliUsage,
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
  maxFetches?: number;
  maxTurns?: number;
  // The prompt's "today" (a test seam); defaults to the clock.
  now?: Date;
};

// Research a SINGLE interest in its own headless `claude` session with only
// WebSearch and WebFetch. Each interest gets its own session so the doc that
// scopes WHAT to look for reaches the model. Returns the session's
// preamble-stripped markdown and what the session used (null when the CLI
// reported nothing); the runner extracts the topic's section and assembles
// the full brief across interests.
export async function researchAndSynthesize(
  interest: ResearchInterest,
  opts: ResearchOptions = {},
): Promise<{ text: string; usage: CliUsage | null }> {
  const prompt = buildResearchPrompt(
    interest,
    opts.now ?? new Date(),
    CLI_RESEARCH_TOOLS,
    {
      maxSearches: opts.maxSearches,
      maxFetches: opts.maxFetches,
    },
  );
  const out = await runClaude(prompt, {
    tools: "web-research",
    label: `claude session for "${interest.topic}"`,
    claudeBin: opts.claudeBin,
    spawnFn: opts.spawnFn,
    timeoutMs: opts.timeoutMs,
    maxTurns: opts.maxTurns,
  });
  const text = stripBriefPreamble(out.text);
  if (!text) throw new Error("claude returned empty output");
  return { text, usage: out.usage };
}

// A make topic's piece (core's make-piece.ts): one session with no tools at
// all, so it never searches. The Scout team runner's counterpart of the
// hosted make run.
export async function writeMakePiece(
  interest: ResearchInterest,
  opts: ResearchOptions = {},
): Promise<{ text: string; usage: CliUsage | null }> {
  const out = await runClaude(
    buildMakePrompt(interest, opts.now ?? new Date()),
    {
      tools: "none",
      label: `claude session for "${interest.topic}"`,
      claudeBin: opts.claudeBin,
      spawnFn: opts.spawnFn,
      timeoutMs: opts.timeoutMs,
    },
  );
  const text = stripBriefPreamble(out.text);
  if (!text) throw new Error("claude returned empty output");
  return { text, usage: out.usage };
}
