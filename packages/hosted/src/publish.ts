// Publishing a topic: the plain checks, one Haiku call through the injected
// Claude client, and the verdict recorded through the injected store. The store
// owns the limits (owner, public cap, publishes a day, the 24 h wait) and the
// final switch to public; this module owns the check between them.
// Host-neutral: the Worker's POST /publish wires it to Supabase.

import {
  PUBLISH_CHECK_SCHEMA,
  buildPublishPrompt,
  parsePublishCheck,
  publishPrecheck,
  type PublishInput,
  type PublishResponse,
  type PublishVerdict,
  HAIKU_MODEL,
} from "@scout/core";
import {
  responseCostUsd,
  tokenCount,
  type ClaudeClient,
  type TokenCount,
} from "@scout/research";

export const PUBLISH_MODEL = HAIKU_MODEL;
// Haiku 5.5 thinks by default (even at effort low), and its thinking counts
// against max_tokens: leave it room before the answer.
const MAX_OUTPUT_TOKENS = 4096;
const CHECK_TIMEOUT_MS = 30_000;

export type PublishStart = PublishInput & {
  checkId: string;
  maxDocChars: number;
};

const NO_TOKENS: TokenCount = { inputTokens: 0, outputTokens: 0 };

export type PublishStore = {
  // Checks the limits and records a check; throws when a limit says no or the
  // topic is not the reader's (the host maps those errors).
  start(userId: string, interestId: string): Promise<PublishStart>;
  // Records the verdict and what the call cost and used; on approve sets the
  // tags and makes the topic public and returns its share slug.
  finish(
    userId: string,
    checkId: string,
    verdict: PublishVerdict,
    costUsd: number,
    tokens: TokenCount,
  ): Promise<string | null>;
};

/** Thrown when the check itself could not run (timeout, API error, cut-off reply). */
export class PublishCheckFailed extends Error {
  override name = "PublishCheckFailed";
}

// A reply cut off at max_tokens: the check did not run, but the call cost.
class CutOffReply extends Error {
  constructor(
    readonly costUsd: number,
    readonly tokens: TokenCount,
  ) {
    super("the reply was cut off at max_tokens");
  }
}

export function createPublish(deps: {
  claude: ClaudeClient;
  store: PublishStore;
}) {
  const { claude, store } = deps;

  async function check(input: PublishInput) {
    const response = await claude.createMessage(
      {
        model: PUBLISH_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: PUBLISH_CHECK_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: buildPublishPrompt(input) }],
          },
        ],
      },
      AbortSignal.timeout(CHECK_TIMEOUT_MS),
    );
    const costUsd = responseCostUsd(response.usage);
    const tokens = tokenCount(response.usage);
    // A cut-off reply says nothing about the topic: a failed check, not a refusal.
    if (response.stop_reason === "max_tokens")
      throw new CutOffReply(costUsd, tokens);
    const text =
      response.stop_reason !== "refusal"
        ? response.content
            .flatMap((b) =>
              b.type === "text" && typeof b.text === "string" ? [b.text] : [],
            )
            .join("")
        : "";
    return {
      verdict: parsePublishCheck(text),
      costUsd,
      tokens,
    };
  }

  return {
    async publish(
      userId: string,
      interestId: string,
    ): Promise<PublishResponse> {
      const start = await store.start(userId, interestId);
      const input: PublishInput = {
        title: start.title,
        doc: start.doc,
        displayName: start.displayName,
      };
      const plain = publishPrecheck(input, start.maxDocChars);
      let verdict: PublishVerdict;
      let costUsd = 0;
      let tokens = NO_TOKENS;
      if (plain) {
        verdict = { approved: false, reason: plain };
      } else {
        try {
          ({ verdict, costUsd, tokens } = await check(input));
        } catch (err) {
          console.error(
            "[publish] check failed:",
            err instanceof Error ? err.message : String(err),
          );
          await store.finish(
            userId,
            start.checkId,
            { approved: false, reason: "check failed" },
            err instanceof CutOffReply ? err.costUsd : 0,
            err instanceof CutOffReply ? err.tokens : NO_TOKENS,
          );
          throw new PublishCheckFailed("the publish check could not run");
        }
      }
      const slug = await store.finish(
        userId,
        start.checkId,
        verdict,
        costUsd,
        tokens,
      );
      if (!verdict.approved)
        return { status: "refused", reason: verdict.reason };
      if (!slug) throw new Error("publish: approved without a slug");
      return { status: "public", slug, tags: verdict.tags };
    },
  };
}
