// The chat model's side of a chat turn: the prompt it gets, and the reply and
// proposed change set parsed out of what it returns. The model never writes
// anything; chat-changes.ts decides what of its proposal lands.

import type { ProposedChange, InterestSnapshot } from "./chat-changes.ts";
import type { AppPage, ChatTurn, Interest } from "./contract.ts";
import { APP_PAGES, SCOUT_GUIDE, appPage } from "./scout-guide.ts";

export type ChatModelOutput = {
  reply: string;
  changes: ProposedChange[];
  page?: AppPage;
};

const CHAT_CONTEXT_TURN_LIMIT = 20;

// The full prompt for one chat turn. `publicInterests` (hosted chat only) are
// curated interests that may match the message; with them the model may offer
// a `follow` instead of creating a near copy. Without them the prompt is the
// companion's. `cadences` (hosted chat only): a topic gets a daily or weekly
// brief, so a create carries the cadence the reader asked for.
export function buildChatPrompt(
  message: string,
  snapshots: InterestSnapshot[],
  transcript: ChatTurn[],
  opts: {
    maxInterests: number;
    maxDocChars?: number;
    publicInterests?: Interest[];
    cadences?: boolean;
  },
): string {
  const { maxInterests } = opts;
  const publicInterests = opts.publicInterests ?? [];
  const lines: string[] = [];
  lines.push(
    "You are Scout's interest assistant. Through conversation you help the user",
  );
  lines.push(
    "manage their personalized-news interests. There is ONE chat for the WHOLE",
  );
  lines.push("set of interests — not one chat per interest.");
  lines.push(
    "You also answer the user's questions about how Scout works. The app calls an",
  );
  lines.push("interest a topic; say topic to the user.");
  lines.push("");
  lines.push(SCOUT_GUIDE);
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
    `Current interests (${snapshots.length} of a maximum of ${maxInterests}), as JSON:`,
  );
  lines.push("```json");
  lines.push(JSON.stringify(snapshots, null, 2));
  lines.push("```");
  lines.push("");
  if (publicInterests.length > 0) {
    lines.push(
      "Public interests that may match (curated; the user can follow one instead of",
    );
    lines.push("creating their own), as JSON:");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        publicInterests.map(({ id, topic }) => ({ id, topic })),
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }
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
    opts.cadences
      ? '    { "op": "create", "topic": "<topic>", "doc": "<full markdown>", "cadence": "daily" | "weekly" },'
      : '    { "op": "create", "topic": "<topic>", "doc": "<full markdown>" },',
  );
  lines.push(
    "    // Completely rewrite an interest's doc from scratch (full replacement):",
  );
  lines.push(
    '    { "op": "rewrite", "interestId": "<existing id>", "doc": "<full new markdown>" },',
  );
  if (publicInterests.length > 0) {
    lines.push("    // Offer to follow a public interest listed above:");
    lines.push('    { "op": "follow", "interestId": "<public interest id>" },');
  }
  lines.push("    // Delete an interest:");
  lines.push('    { "op": "delete", "interestId": "<existing id>" }');
  lines.push("  ],");
  lines.push(
    '  "page": "<optional: one app page to offer the user, from the list below>"',
  );
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
    '- When the request is too vague to know what to track ("news", "something',
  );
  lines.push(
    '    interesting"), ask one short question with `changes: []` instead of creating.',
  );
  lines.push(
    "- One topic is one subject. A run has only a few searches, so when one create or",
    '    update mixes unrelated subjects ("AI news, Premier League and Oslo housing"),',
    "    don't save yet: reply with `changes: []` and offer to split them into separate",
    "    topics or to keep the one or two that matter most. Related parts of one subject",
    '    stay one topic ("Bambu firmware and filament").',
  );
  if (opts.cadences) {
    lines.push(
      "    Be honest about the plan: only its daily and weekly slots run on a",
      "    schedule; other topics run only with Run now.",
    );
  }
  lines.push("    If the user still wants them together, save as asked.");
  if (opts.cadences) {
    lines.push(
      '- On a `create`, set `cadence` to what the user asked for: "weekly", "every',
    );
    lines.push(
      '    week", "once a week" mean weekly; "daily", "every day" mean daily. When they',
    );
    lines.push(
      "    named none, omit `cadence` (the topic takes the next free slot). Never make a",
    );
    lines.push("    topic daily when the user said weekly.");
    lines.push(
      "- A new topic is private: only the user sees it until they share it. A create's",
    );
    lines.push(
      "    `reply` confirms what you set up: the topic in quotes, its cadence (Daily or",
    );
    lines.push(
      "    Weekly; or the next free slot when they named none) and that it is private,",
    );
    lines.push(
      '    then invites changes. E.g. "Created \\"Zigbee\\" — Weekly, private. Tell me',
    );
    lines.push('    what to change."');
  } else {
    lines.push(
      "- A create's `reply` names the new topic in quotes and what it will track.",
    );
  }
  lines.push(
    "- `doc` must be the COMPLETE new document, never a diff or fragment.",
  );
  if (opts.maxDocChars !== undefined) {
    lines.push(
      `- Keep every \`doc\` under ${opts.maxDocChars} characters; a longer one is dropped.`,
    );
  }
  lines.push(
    `- There is a hard cap of ${maxInterests} interests; don't create past it.`,
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
    `    Say e.g. "Delete \\"X\\"? Confirm below — this would bring you to N of ${maxInterests} interests."`,
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
  if (publicInterests.length > 0) {
    lines.push(
      "- When a public interest listed above already covers what the user asks for,",
    );
    lines.push(
      "    offer it instead of creating a near copy: emit `follow` with its id and NO",
    );
    lines.push(
      "    `create`. Following is free and does not count toward the cap. A `follow` is",
    );
    lines.push(
      "    CONFIRM-GATED like `delete`: phrase `reply` as an offer, e.g. \"There's already",
    );
    lines.push(
      '    a curated \\"X\\" — follow it? Confirm below." Public interest ids are ONLY for',
    );
    lines.push(
      "    `follow`; never update, rewrite or delete one. If none fits, create as usual.",
    );
  }
  lines.push(
    "- A how-to question about Scout gets a short answer from the guide above and",
  );
  lines.push(
    "    `changes: []`. Never invent a feature, setting or limit the guide doesn't",
  );
  lines.push(
    "    name; if it doesn't say, tell the user you don't know. Never write a URL in",
  );
  lines.push(
    "    `reply`. When a page would help, set `page` to exactly one of:",
  );
  lines.push(`    ${Object.keys(APP_PAGES).join(", ")}. Otherwise omit it.`);
  lines.push("- Do not use any tools. Output only the JSON object.");
  return lines.join("\n");
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
  const obj = parsed as { reply?: unknown; changes?: unknown; page?: unknown };
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const changes = Array.isArray(obj.changes)
    ? (obj.changes as ProposedChange[])
    : [];
  const page = appPage(obj.page);
  return page ? { reply, changes, page } : { reply, changes };
}
