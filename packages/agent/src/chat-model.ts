// The chat model seam: core's chat prompt sent to a tool-less `claude` child,
// and the reply and proposed changes parsed out of what it prints. The model
// never writes anything; chat-changes.ts decides what of its proposal lands.

import type { spawn } from "node:child_process";
import {
  buildChatPrompt,
  parseChatOutput,
  type ChatModelOutput,
  type ChatTurn,
  type Interest,
  type InterestSnapshot,
} from "#core";
import { runClaude } from "./claude-runner.js";
import { readInterestDoc } from "./docs.js";
// Shared with the POST/PUT /v0/interests validator — see limits.ts for why the
// constant lives in a leaf module rather than next to either consumer.
import { MAX_INTERESTS } from "./limits.js";

export type ChatOptions = {
  claudeBin?: string;
  // Spawn override for tests — injects a stub `claude` without the real binary
  // or network, exactly like ResearchOptions.spawnFn.
  spawnFn?: typeof spawn;
  // Abort signal: when fired, the `claude` child is killed and the
  // round-trip rejects, so the turn can land as stopped WITHOUT applying changes.
  signal?: AbortSignal;
  // Per-turn hard timeout in ms. Defaults to SCOUT_SESSION_TIMEOUT_MS
  // env or 4 min; tests set it tiny to drive the kill path without waiting.
  timeoutMs?: number;
};

export async function buildInterestSnapshots(
  interests: Interest[],
  interestsDir: string,
): Promise<InterestSnapshot[]> {
  return await Promise.all(
    interests.map(async (it) => ({
      id: it.id,
      topic: it.topic,
      doc: (await readInterestDoc(it.id, interestsDir)) ?? "",
    })),
  );
}

// Run one chat turn through a tool-less `claude` child and parse its JSON
// output. A Stop (opts.signal) kills the child and rejects, so the turn lands
// stopped without applying changes.
export async function chatComplete(
  message: string,
  snapshots: InterestSnapshot[],
  transcript: ChatTurn[] = [],
  opts: ChatOptions = {},
): Promise<ChatModelOutput> {
  const prompt = buildChatPrompt(message, snapshots, transcript, {
    maxInterests: MAX_INTERESTS,
  });
  const raw = await runClaude(prompt, {
    tools: "none",
    label: "claude chat turn",
    claudeBin: opts.claudeBin,
    spawnFn: opts.spawnFn,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  return parseChatOutput(raw);
}
