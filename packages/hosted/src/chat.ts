// The hosted setup chat: one chat turn through the Claude API, and the reader's
// confirms of what a turn proposed. The model only proposes a change set; core's
// planChatChanges decides what lands, and new topics, deletes, full rewrites
// and follows wait for a confirm that names a proposal the store holds (never one the
// client sends). Host-neutral: the host injects the Claude client and the store.
//
// Left to the host: auth, the daily turn quota, the global ceiling and kill
// switch, and one turn at a time per reader.

import {
  APP_PAGES,
  FEEDBACK_SCHEMA_PROPERTIES,
  FEEDBACK_SENT_REPLY,
  buildChatPrompt,
  feedbackOf,
  parseChatOutput,
  planChatChanges,
  type ChatChange,
  type ChatConfirm,
  type ChatTurn,
  type Interest,
  type PendingFeedback,
  type InterestSnapshot,
  HAIKU_MODEL,
  MAX_TOPIC_CHARS,
  quotedList,
} from "@scout/core";
import {
  responseCostUsd,
  tokenCount,
  type ClaudeClient,
  type MessagesResponse,
  type TokenCount,
} from "@scout/research";

export type ChatStore = {
  // The reader's own interests with their intent docs, their recent chat turns
  // (oldest first, the last one being the turn a confirm answers), and their
  // plan's limits.
  load(userId: string): Promise<{
    interests: InterestSnapshot[];
    transcript: ChatTurn[];
    // `dailyInterests`: the plan's daily topics; 0 (Free) makes a daily ask
    // weekly. Absent: no daily cap is known.
    limits: {
      maxInterests: number;
      maxDocChars: number;
      dailyInterests?: number;
    };
    // The `feedback_on` setting: the chat may draft notes to the Scout team.
    feedbackOn?: boolean;
    // The `make_on` setting: the chat may create make topics (core's
    // make-piece.ts).
    makeOn?: boolean;
  }>;
  // Up to `limit` public interests, best matches for `message` first, leaving
  // out the reader's own and those they already follow.
  findPublicInterests(
    userId: string,
    message: string,
    limit: number,
  ): Promise<Interest[]>;
  // In one transaction: apply `turn.changes` (a create carries its new id),
  // add the `follows`, and append `turn` as the reader's latest chat turn
  // with what its model call cost and used.
  commit(
    userId: string,
    commit: {
      turn: ChatTurn;
      follows: string[];
      costUsd: number;
      tokens: TokenCount;
    },
  ): Promise<void>;
  // In one transaction: store `feedback` from the card in turn `cardTurnId`
  // unless a feedback limit is reached, and append `turn` as a free turn (it
  // does not count toward the daily chat limit). Returns null when sent, or
  // the reason it was not, which also becomes the stored turn's reply.
  sendFeedback(
    userId: string,
    send: { cardTurnId: string; feedback: PendingFeedback; turn: ChatTurn },
  ): Promise<string | null>;
};

// The confirm body is part of the Worker's HTTP contract, so it lives in core.
export type { ChatConfirm };

export const CHAT_MODEL = HAIKU_MODEL;
// The public catalog the model sees: topics only, so a short list stays cheap.
const PUBLIC_INTEREST_LIMIT = 20;
const MAX_OUTPUT_TOKENS = 8192;
const TURN_TIMEOUT_MS = 60_000;

// The change set's shape, enforced by the API's structured output. It only
// guarantees well-formed JSON: planChatChanges and feedbackOf still check
// every field. The feedback op is in it only while feedback is on, and a
// create's mode only while make mode is on.
function chatOutputSchema(feedback: boolean, make: boolean) {
  return {
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
              enum: [
                "create",
                "update",
                "rewrite",
                "delete",
                "follow",
                ...(feedback ? ["feedback"] : []),
              ],
            },
            interestId: { type: "string" },
            topic: { type: "string" },
            doc: { type: "string" },
            cadence: { type: "string", enum: ["daily", "weekly"] },
            ...(make
              ? { mode: { type: "string", enum: ["news", "make"] } }
              : {}),
            ...(feedback ? FEEDBACK_SCHEMA_PROPERTIES : {}),
          },
        },
      },
      page: { type: "string", enum: Object.keys(APP_PAGES) },
    },
  };
}

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
  // reader. Only a store failure rejects. `turnId` is the id the host reserved
  // for this turn before the call (the Worker's begin_chat_turn); the commit
  // completes that reservation.
  async function turn(
    userId: string,
    message: string,
    opts: { turnId?: string } = {},
  ): Promise<ChatTurn> {
    const { interests, transcript, limits, feedbackOn, makeOn } =
      await store.load(userId);
    const feedback = feedbackOn === true;
    const make = makeOn === true;
    const base = {
      id: opts.turnId ?? newId(),
      created_at: now().toISOString(),
      message,
    };
    let costUsd = 0;
    let tokens = NO_TOKENS;
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
            format: {
              type: "json_schema",
              schema: chatOutputSchema(feedback, make),
            },
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
                    cadences: true,
                    noDaily: limits.dailyInterests === 0,
                    feedback,
                    make,
                  }),
                },
              ],
            },
          ],
        },
        AbortSignal.timeout(TURN_TIMEOUT_MS),
      );
      costUsd = chatCostUsd(response);
      tokens = tokenCount(response.usage);
      const output = parseChatOutput(responseText(response));
      const plan = planChatChanges(interests, output.changes, {
        ...limits,
        maxTopicLen: MAX_TOPIC_CHARS,
        newId,
        publicInterests,
        message,
        make,
      });
      const { pendingDeletes, pendingRewrites, pendingFollows } = plan;
      const pendingFeedback = feedback ? feedbackOf(output.changes) : undefined;
      // A new topic waits for the reader's confirm, so they see its title
      // and cadence before it is saved and its first brief is queued.
      // On a plan with no daily topics, a daily ask is made weekly.
      const pendingCreates = plan.applied.flatMap((c) => {
        if (c.op !== "create") return [];
        const cadence =
          c.cadence === "daily" && limits.dailyInterests === 0
            ? "weekly"
            : c.cadence;
        return [
          {
            interestId: c.interestId,
            topic: c.topic ?? "",
            doc: c.doc ?? "",
            ...(cadence ? { cadence } : {}),
            ...(c.mode ? { mode: c.mode } : {}),
          },
        ];
      });
      result = {
        follows: [],
        turn: {
          ...base,
          status: "ready",
          reply: output.reply,
          changes: plan.applied.filter((c) => c.op !== "create"),
          ...(output.page ? { page: output.page } : {}),
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
          ...(pendingCreates.length > 0
            ? { pending_creates: pendingCreates }
            : {}),
          ...(pendingFeedback ? { pending_feedback: pendingFeedback } : {}),
        },
      };
    } catch (err) {
      result = {
        follows: [],
        turn: { ...base, status: "failed", error_msg: failureMessage(err) },
      };
    }
    await store.commit(userId, { ...result, costUsd, tokens });
    return result.turn;
  }

  // The reader's confirm of a proposal in their latest turn. Returns the
  // committed confirm turn, or null when that turn holds no such proposal (a
  // stale card or a second confirm). No model call.
  async function confirm(
    userId: string,
    action: ChatConfirm,
  ): Promise<ChatTurn | null> {
    const { interests, transcript, feedbackOn } = await store.load(userId);
    const last = transcript.at(-1);
    if (!last || last.status !== "ready") return null;
    if (action.kind === "feedback") {
      const feedback = last.pending_feedback;
      if (feedbackOn !== true || !feedback) return null;
      const turn: ChatTurn = {
        id: newId(),
        created_at: now().toISOString(),
        status: "ready",
        message: `Send feedback: ${feedback.summary}`,
        reply: FEEDBACK_SENT_REPLY,
        changes: [],
      };
      const blocked = await store.sendFeedback(userId, {
        cardTurnId: last.id,
        feedback,
        turn,
      });
      return blocked === null ? turn : { ...turn, reply: blocked };
    }
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
    await store.commit(userId, {
      turn,
      follows: outcome.follows,
      costUsd: 0,
      tokens: NO_TOKENS,
    });
    return turn;
  }

  return { turn, confirm };
}

function confirmOutcome(
  last: ChatTurn,
  interests: InterestSnapshot[],
  action: Exclude<ChatConfirm, { kind: "feedback" }>,
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
  if (action.kind === "create") {
    const pending = last.pending_creates?.find(
      (p) => p.interestId === action.interestId,
    );
    if (!pending || interests.some((i) => i.id === pending.interestId)) {
      return null;
    }
    return {
      message: `Create "${pending.topic}"`,
      reply: `Created "${pending.topic}".`,
      changes: [{ ...pending, op: "create" }],
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

const NO_TOKENS: TokenCount = { inputTokens: 0, outputTokens: 0 };

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
