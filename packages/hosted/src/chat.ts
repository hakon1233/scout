// The hosted setup chat: one chat turn through the Claude API, and the reader's
// confirms of what a turn proposed. The model only proposes a change set; core's
// planChatChanges decides what lands, and deletes, full rewrites and follows
// wait for a confirm that names a proposal the store holds (never one the
// client sends). Host-neutral: the host injects the Claude client and the store.
//
// Left to the host: auth, the daily turn quota, the global ceiling and kill
// switch, and one turn at a time per reader.

import {
  buildChatPrompt,
  parseChatOutput,
  planChatChanges,
  type ChatChange,
  type ChatConfirm,
  type ChatTurn,
  type Interest,
  type InterestSnapshot,
} from "@scout/core";
import {
  responseCostUsd,
  type ClaudeClient,
  type MessagesResponse,
} from "@scout/research";

export type ChatStore = {
  // The reader's own interests with their intent docs, their recent chat turns
  // (oldest first, the last one being the turn a confirm answers), and their
  // plan's limits.
  load(userId: string): Promise<{
    interests: InterestSnapshot[];
    transcript: ChatTurn[];
    limits: { maxInterests: number; maxDocChars: number };
  }>;
  // Up to `limit` public interests, best matches for `message` first, leaving
  // out the reader's own and those they already follow.
  findPublicInterests(
    userId: string,
    message: string,
    limit: number,
  ): Promise<Interest[]>;
  // In one transaction: apply `turn.changes` (a create carries its new id),
  // add the `follows`, and append `turn` as the reader's latest chat turn.
  commit(
    userId: string,
    commit: { turn: ChatTurn; follows: string[]; costUsd: number },
  ): Promise<void>;
};

// The confirm body is part of the Worker's HTTP contract, so it lives in core.
export type { ChatConfirm };

export const CHAT_MODEL = "claude-haiku-5-5";
// The public catalog the model sees: topics only, so a short list stays cheap.
const PUBLIC_INTEREST_LIMIT = 20;
const MAX_TOPIC_LEN = 200; // interests.topic's check in the schema
const MAX_OUTPUT_TOKENS = 8192;
const TURN_TIMEOUT_MS = 60_000;

// The change set's shape, enforced by the API's structured output. It only
// guarantees well-formed JSON: planChatChanges still checks every field.
const CHAT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "changes"],
  properties: {
    reply: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op"],
        properties: {
          op: {
            type: "string",
            enum: ["create", "update", "rewrite", "delete", "follow"],
          },
          interestId: { type: "string" },
          topic: { type: "string" },
          doc: { type: "string" },
        },
      },
    },
  },
};

export function createChat(deps: {
  claude: ClaudeClient;
  store: ChatStore;
  newId?: () => string;
  now?: () => Date;
}) {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date());
  const { claude, store } = deps;

  // One chat turn. Always resolves to the committed turn: `ready` with what
  // landed and what waits for a confirm, or `failed` with a message for the
  // reader. Only a store failure rejects.
  async function turn(userId: string, message: string): Promise<ChatTurn> {
    const { interests, transcript, limits } = await store.load(userId);
    const base = {
      id: newId(),
      created_at: now().toISOString(),
      message,
    };
    let costUsd = 0;
    let result: { turn: ChatTurn; follows: string[] };
    try {
      const publicInterests = await store.findPublicInterests(
        userId,
        message,
        PUBLIC_INTEREST_LIMIT,
      );
      const response = await claude.createMessage(
        {
          model: CHAT_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: CHAT_OUTPUT_SCHEMA },
          },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildChatPrompt(message, interests, transcript, {
                    ...limits,
                    publicInterests,
                  }),
                },
              ],
            },
          ],
        },
        AbortSignal.timeout(TURN_TIMEOUT_MS),
      );
      costUsd = chatCostUsd(response);
      const output = parseChatOutput(responseText(response));
      const plan = planChatChanges(interests, output.changes, {
        ...limits,
        maxTopicLen: MAX_TOPIC_LEN,
        newId,
        publicInterests,
      });
      const { pendingDeletes, pendingRewrites, pendingFollows } = plan;
      result = {
        follows: [],
        turn: {
          ...base,
          status: "ready",
          reply: output.reply,
          changes: plan.applied,
          ...(pendingDeletes.length > 0
            ? {
                pending_deletes: pendingDeletes,
                pending_delete: pendingDeletes[0],
              }
            : {}),
          ...(pendingRewrites.length > 0
            ? { pending_rewrite: pendingRewrites[0] }
            : {}),
          ...(pendingFollows.length > 0
            ? { pending_follows: pendingFollows }
            : {}),
        },
      };
    } catch (err) {
      result = {
        follows: [],
        turn: { ...base, status: "failed", error_msg: failureMessage(err) },
      };
    }
    await store.commit(userId, { ...result, costUsd });
    return result.turn;
  }

  // The reader's confirm of a proposal in their latest turn. Returns the
  // committed confirm turn, or null when that turn holds no such proposal (a
  // stale card or a second confirm). No model call.
  async function confirm(
    userId: string,
    action: ChatConfirm,
  ): Promise<ChatTurn | null> {
    const { interests, transcript } = await store.load(userId);
    const last = transcript.at(-1);
    if (!last || last.status !== "ready") return null;
    const outcome = confirmOutcome(last, interests, action);
    if (!outcome) return null;
    const turn: ChatTurn = {
      id: newId(),
      created_at: now().toISOString(),
      status: "ready",
      message: outcome.message,
      reply: outcome.reply,
      changes: outcome.changes,
    };
    await store.commit(userId, { turn, follows: outcome.follows, costUsd: 0 });
    return turn;
  }

  return { turn, confirm };
}

function confirmOutcome(
  last: ChatTurn,
  interests: InterestSnapshot[],
  action: ChatConfirm,
): {
  message: string;
  reply: string;
  changes: ChatChange[];
  follows: string[];
} | null {
  if (action.kind === "delete") {
    const pending = last.pending_deletes ?? [];
    const ids = action.interestIds;
    if (
      ids.length === 0 ||
      !ids.every((id) => pending.some((p) => p.interestId === id))
    ) {
      return null;
    }
    const changes: ChatChange[] = interests
      .filter((i) => ids.includes(i.id))
      .map((i) => ({ interestId: i.id, op: "delete", topic: i.topic }));
    if (changes.length === 0) return null;
    const topics = quotedList(changes.map((c) => c.topic ?? ""));
    return {
      message: `Delete ${topics}`,
      reply: `Removed ${topics} from your interests.`,
      changes,
      follows: [],
    };
  }
  if (action.kind === "rewrite") {
    const pending = last.pending_rewrite;
    if (!pending || pending.interestId !== action.interestId) return null;
    const target = interests.find((i) => i.id === action.interestId);
    if (!target) return null;
    return {
      message: `Apply rewrite of "${target.topic}"`,
      reply: `Applied the rewrite of "${target.topic}".`,
      changes: [
        {
          interestId: target.id,
          op: "update",
          topic: target.topic,
          doc: pending.doc,
        },
      ],
      follows: [],
    };
  }
  const pending = last.pending_follows?.find(
    (p) => p.interestId === action.interestId,
  );
  if (!pending) return null;
  return {
    message: `Follow "${pending.topic}"`,
    reply: `You now follow "${pending.topic}".`,
    changes: [],
    follows: [pending.interestId],
  };
}

// The JSON text of a structured-output response. A refusal or a cut-off answer
// has no complete JSON to read, so it fails the turn.
function responseText(response: MessagesResponse): string {
  if (response.stop_reason === "refusal") {
    throw new Error("chat model refused");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("chat model ran out of output tokens");
  }
  return response.content
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("");
}

// One turn's cost, from research's shared Haiku price table.
export function chatCostUsd(response: MessagesResponse): number {
  return responseCostUsd(response.usage);
}

// The reason a failed turn gives the reader. The raw error goes to the log.
function failureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.error("[chat] turn failed:", raw);
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 429 || status === 529) {
    return "Scout's chat is busy right now. Try again in a minute.";
  }
  if (/^chat model refused/.test(raw)) {
    return "Claude declined to answer that. Try rephrasing.";
  }
  if (/^chat model (did not return|returned invalid|ran out)/.test(raw)) {
    return "Claude's answer couldn't be read. Try again.";
  }
  return "Something went wrong. Try again.";
}

// "A", "A" and "B", or "A", "B" and "C".
function quotedList(items: string[]): string {
  const quoted = items.map((t) => `"${t}"`);
  return quoted.length < 2
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}
