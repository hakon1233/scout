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
} from "@scout/core";
import { responseCostUsd, type ClaudeClient } from "@scout/research";

export const PUBLISH_MODEL = "claude-haiku-5-5";
const MAX_OUTPUT_TOKENS = 1024;
const CHECK_TIMEOUT_MS = 30_000;

export type PublishStart = PublishInput & {
  checkId: string;
  maxDocChars: number;
};

export type PublishStore = {
  // Checks the limits and records a check; throws when a limit says no or the
  // topic is not the reader's (the host maps those errors).
  start(userId: string, interestId: string): Promise<PublishStart>;
  // Records the verdict; on approve sets the tags and makes the topic public
  // and returns its share slug.
  finish(
    userId: string,
    checkId: string,
    verdict: PublishVerdict,
    costUsd: number,
  ): Promise<string | null>;
};

/** Thrown when the check itself could not run (timeout, API error). */
export class PublishCheckFailed extends Error {
  override name = "PublishCheckFailed";
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
    const text =
      response.stop_reason !== "refusal" &&
      response.stop_reason !== "max_tokens"
        ? response.content
            .flatMap((b) =>
              b.type === "text" && typeof b.text === "string" ? [b.text] : [],
            )
            .join("")
        : "";
    return {
      verdict: parsePublishCheck(text),
      costUsd: responseCostUsd(response.usage),
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
      if (plain) {
        verdict = { approved: false, reason: plain };
      } else {
        try {
          ({ verdict, costUsd } = await check(input));
        } catch (err) {
          console.error(
            "[publish] check failed:",
            err instanceof Error ? err.message : String(err),
          );
          await store.finish(
            userId,
            start.checkId,
            { approved: false, reason: "check failed" },
            0,
          );
          throw new PublishCheckFailed("the publish check could not run");
        }
      }
      const slug = await store.finish(userId, start.checkId, verdict, costUsd);
      if (!verdict.approved)
        return { status: "refused", reason: verdict.reason };
      if (!slug) throw new Error("publish: approved without a slug");
      return { status: "public", slug, tags: verdict.tags };
    },
  };
}
