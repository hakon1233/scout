// The chat model seam: the prompt a chat turn sends a tool-less `claude`
// child, and the reply and proposed changes parsed out of what it prints. The
// model never writes anything; chat-changes.ts decides what of its proposal
// lands.

import type { spawn } from "node:child_process";
import type { ChatTurn, Interest } from "./contract.js";
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
  // Abort signal (PER-232): when fired, the `claude` child is killed and the
  // round-trip rejects, so the turn can land as stopped WITHOUT applying changes.
  signal?: AbortSignal;
  // Per-turn hard timeout in ms (AIR-540). Defaults to SCOUT_SESSION_TIMEOUT_MS
  // env or 4 min; tests set it tiny to drive the kill path without waiting.
  timeoutMs?: number;
};

// What the model is asked to return: a reply plus the changes it wants applied.
// `interestId` is omitted on create (the system assigns it). We validate this
// shape defensively before trusting any field.
export type ProposedChange = {
  op?: unknown;
  interestId?: unknown;
  topic?: unknown;
  doc?: unknown;
};
export type ChatModelOutput = {
  reply: string;
  changes: ProposedChange[];
};

// Snapshot of an interest handed to the model: its id, topic, and current doc so
// the model can "read" the doc before proposing an edit.
export type InterestSnapshot = { id: string; topic: string; doc: string };

const CHAT_CONTEXT_TURN_LIMIT = 20;

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

export function buildChatPrompt(
  message: string,
  snapshots: InterestSnapshot[],
  transcript: ChatTurn[] = [],
): string {
  const lines: string[] = [];
  lines.push(
    "You are Scout's interest assistant. Through conversation you help the user",
  );
  lines.push(
    "manage their personalized-news interests. There is ONE chat for the WHOLE",
  );
  lines.push("set of interests — not one chat per interest.");
  lines.push("");
  lines.push("Each interest has:");
  lines.push("- an `id`: an opaque, stable handle (do NOT invent new ids),");
  lines.push("- a `topic`: the short headline the news engine searches on,");
  lines.push(
    "- a `doc`: free-form markdown capturing EXACTLY what the user wants from that",
  );
  lines.push(
    "  topic. This doc is injected verbatim into the topic's research prompt, so",
  );
  lines.push("  refining it directly changes what the next brief researches.");
  lines.push("");
  lines.push(
    `Current interests (${snapshots.length} of a maximum of ${MAX_INTERESTS}), as JSON:`,
  );
  lines.push("```json");
  lines.push(JSON.stringify(snapshots, null, 2));
  lines.push("```");
  lines.push("");
  const contextTurns = transcript
    .filter((turn) => turn.status === "ready" || turn.status === "failed")
    .slice(-CHAT_CONTEXT_TURN_LIMIT);
  if (contextTurns.length > 0) {
    lines.push(
      `Recent conversation (${contextTurns.length} prior turns, oldest first):`,
    );
    lines.push("```json");
    lines.push(
      JSON.stringify(
        contextTurns.map((turn) => ({
          user: turn.message,
          assistant:
            turn.status === "ready"
              ? (turn.reply ?? "")
              : `[failed: ${turn.error_msg ?? "unknown error"}]`,
          changes: turn.changes ?? [],
        })),
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }
  lines.push("The user says:");
  lines.push('"""');
  lines.push(message);
  lines.push('"""');
  lines.push("");
  lines.push(
    "Decide what changes (if any) to make to the interests, then reply to the user.",
  );
  lines.push("");
  lines.push(
    "Respond with a SINGLE JSON object and NOTHING else (no prose, no code fence):",
  );
  lines.push("{");
  lines.push('  "reply": "<your short conversational reply to the user>",');
  lines.push('  "changes": [');
  lines.push("    // Refine or replace an existing interest's intent doc:");
  lines.push(
    '    { "op": "update", "interestId": "<existing id>", "doc": "<full new markdown>" },',
  );
  lines.push("    // Add a topic rename by also including a topic field:");
  lines.push(
    '    { "op": "update", "interestId": "<existing id>", "topic": "<new topic>", "doc": "<full markdown>" },',
  );
  lines.push(
    "    // Create a new interest (do NOT supply an id — the system mints it):",
  );
  lines.push(
    '    { "op": "create", "topic": "<topic>", "doc": "<full markdown>" },',
  );
  lines.push(
    "    // Completely rewrite an interest's doc from scratch (full replacement):",
  );
  lines.push(
    '    { "op": "rewrite", "interestId": "<existing id>", "doc": "<full new markdown>" },',
  );
  lines.push("    // Delete an interest:");
  lines.push('    { "op": "delete", "interestId": "<existing id>" }');
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push(
    "- Include ONLY the changes you are actually making this turn; use [] when none.",
  );
  lines.push(
    '- For "update"/"rewrite"/"delete", `interestId` MUST be one of the ids listed above.',
  );
  lines.push('- For "create", OMIT `interestId`; never invent one.');
  lines.push(
    "- `doc` must be the COMPLETE new document, never a diff or fragment.",
  );
  lines.push(
    `- There is a hard cap of ${MAX_INTERESTS} interests; don't create past it.`,
  );
  lines.push(
    "- Choosing the op is important. If the user wants to REMOVE a topic from",
  );
  lines.push(
    '    their interests — "delete X", "remove X", "drop X", "get rid of X", "stop',
  );
  lines.push(
    '    tracking X", "I no longer care about X" — emit a `delete` op for that',
  );
  lines.push(
    "    interest's id. Deleting is the ONLY way to remove an interest: NEVER try to",
  );
  lines.push(
    '    "remove" it by emptying, blanking, or rewriting its `doc` with an `update` —',
  );
  lines.push(
    "    an update keeps the interest alive and still feeds the next brief. Reserve",
  );
  lines.push(
    "    `update` for when the user wants to KEEP the topic but change what it tracks.",
  );
  lines.push(
    "- A `delete` is CONFIRM-GATED: emitting it does NOT remove the interest. The user",
  );
  lines.push(
    "    still has to press [Delete] on a confirmation card. So when your changes include",
  );
  lines.push(
    "    a `delete`, phrase `reply` as a PENDING REQUEST, never as a completed action.",
  );
  lines.push(
    `    Say e.g. "Delete \\"X\\"? Confirm below — this would bring you to N of ${MAX_INTERESTS} interests."`,
  );
  lines.push(
    '    NEVER claim it is done ("Done — deleted", "Removed X", "You\'re back to N") on a',
  );
  lines.push(
    "    delete turn; the interest is still there until the user confirms. Create/update",
  );
  lines.push(
    "    apply immediately, so for those a done-style reply is correct.",
  );
  lines.push(
    "- A `rewrite` is for a FULL from-scratch replacement of an interest's doc — the",
  );
  lines.push(
    '    user asks to "completely rewrite", "start over", "rewrite from scratch", or',
  );
  lines.push(
    "    otherwise wants the WHOLE doc replaced rather than refined. Like `delete`, a",
  );
  lines.push(
    "    `rewrite` is CONFIRM-GATED: emitting it does NOT change the doc. The user still",
  );
  lines.push(
    "    has to press [Apply] on a proposal card showing the diff. `doc` MUST be the",
  );
  lines.push(
    "    COMPLETE proposed document. When your changes include a `rewrite`, phrase",
  );
  lines.push(
    "    `reply` as a PENDING PROPOSAL, never as a completed action. Say e.g. \"Here's",
  );
  lines.push(
    '    a full rewrite of \\"X\\" — review the diff and Apply below." NEVER claim it is',
  );
  lines.push(
    '    done ("Done — rewrote it", "Updated X") on a rewrite turn; the doc is unchanged',
  );
  lines.push(
    "    until the user applies. Reserve `update` for incremental refinements the user",
  );
  lines.push("    asked to make directly — those still apply immediately.");
  lines.push("- Do not use any tools. Output only the JSON object.");
  return lines.join("\n");
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
  const raw = await runClaude(buildChatPrompt(message, snapshots, transcript), {
    tools: "none",
    label: "claude chat turn",
    claudeBin: opts.claudeBin,
    spawnFn: opts.spawnFn,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  return parseChatOutput(raw);
}

// Extract the JSON object from the model's text output and coerce it into the
// ChatModelOutput shape. Robust to a stray code fence or leading/trailing prose:
// we slice from the first `{` to the last `}`. Throws on anything unparseable so
// the turn lands as `failed` rather than silently dropping the user's edit.
export function parseChatOutput(raw: string): ChatModelOutput {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("chat model did not return a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`chat model returned invalid JSON: ${String(err)}`);
  }
  const obj = parsed as { reply?: unknown; changes?: unknown };
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const changes = Array.isArray(obj.changes)
    ? (obj.changes as ProposedChange[])
    : [];
  return { reply, changes };
}
