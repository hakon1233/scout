// One interest's research as one Claude API call: Haiku with the server-side
// web search and web fetch tools. The hosted counterpart of the companion's
// claude-runner + research. The prompt, the clean-up, freshness and coverage
// all come from @scout/core; this module adds only the API call around them.

import {
  API_RESEARCH_TOOLS,
  buildResearchPrompt,
  HAIKU_MODEL,
  sectionFromAnswer,
  type ResearchInterest,
  type TopicCoverage,
} from "@scout/core";
import type {
  ClaudeClient,
  ContentBlock,
  MessagesRequest,
  MessagesResponse,
} from "./claude-client.ts";
import { responseCostUsd } from "./pricing.ts";

export const RESEARCH_MODEL = HAIKU_MODEL;

// Room for adaptive thinking plus a long (~1100-word) section.
const MAX_TOKENS = 16_000;
// Each fetched page is cut to about this many tokens. Every step of the
// server-tool loop re-reads earlier tool results, so long pages pushed real
// runs to 84K-99.8K prompt tokens, just under the 100K line where Haiku's
// long-prompt rates (5x) start. Article text sat in the first ~6-8K tokens.
const MAX_FETCH_CONTENT_TOKENS = 6000;
// The free plan's searches_per_run.
const DEFAULT_MAX_SEARCHES = 5;
const DEFAULT_MAX_FETCHES = 5;
// The whole call, across every pause_turn continuation.
const DEFAULT_TIMEOUT_MS = 300_000;
// pause_turn resumes after the first request. The API pauses after 10
// server-side steps, and max_uses caps the tool calls, so a healthy run needs
// at most one or two.
const MAX_CONTINUATIONS = 3;
// A run stops before its next continuation once it has spent this much. A
// healthy run costs a few cents (five searches plus cached prompt reads).
export const DEFAULT_MAX_COST_USD = 0.25;
// Tool error codes that mean a limit was hit: running again won't help.
const LIMIT_TOOL_ERRORS = new Set(["max_uses_exceeded", "too_many_requests"]);

export type ResearchDeps = {
  claude: ClaudeClient;
  now?: Date;
  maxSearches?: number; // the plan's searches_per_run
  maxFetches?: number;
  timeoutMs?: number;
  maxCostUsd?: number; // the per-run spend cap
};

export type ResearchUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
  costUsd: number;
};

export type ResearchResult = {
  // The topic's section under its canonical `## <topic>` heading, stale
  // stories dropped. null when the session failed (coverage "missing").
  sectionMd: string | null;
  coverage: TopicCoverage;
  // What the call cost, failed or not, so a ledger records every dollar.
  usage: ResearchUsage;
  // Why the section is missing, and whether one more attempt could help
  // (a 5xx, a dropped connection, a bad answer) or not (a 4xx, a rate or
  // spend limit, a timeout, a refusal). Only set when sectionMd is null.
  error?: string;
  retryable?: boolean;
};

// Basic tool versions: no dynamic filtering, so max_uses caps every search
// and fetch across pause_turn continuations. The _20260209 versions filter
// results in code first, but their code-run searches escape max_uses.
// A search locale with a region ("nb-NO") also tells web_search where the
// reader is, so local results rank first. No allowed_domains: the intent doc
// steers sources, the tool never fences them.
function webTools(
  maxSearches: number,
  maxFetches: number,
  searchLocale: string | null,
): ContentBlock[] {
  const country = searchLocale?.split("-")[1];
  return [
    {
      type: "web_search_20250305",
      name: API_RESEARCH_TOOLS.search,
      max_uses: maxSearches,
      ...(country ? { user_location: { type: "approximate", country } } : {}),
    },
    {
      type: "web_fetch_20250910",
      name: API_RESEARCH_TOOLS.fetch,
      max_uses: maxFetches,
      max_content_tokens: MAX_FETCH_CONTENT_TOKENS,
    },
  ];
}

// Never throws: every failure, including the client's own, comes back as a
// "missing" topic with an error and the usage spent so far.
export async function researchInterest(
  interest: ResearchInterest,
  deps: ResearchDeps,
): Promise<ResearchResult> {
  const now = deps.now ?? new Date();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const usage = emptyUsage();
  const maxCostUsd = deps.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const missing = (error: string, retryable: boolean): ResearchResult => ({
    sectionMd: null,
    coverage: { topic: interest.topic, status: "missing" },
    usage,
    error,
    retryable,
  });

  // The prompt is the cache breakpoint, so each pause_turn continuation
  // reads it from the cache instead of paying for it again.
  const user = {
    role: "user" as const,
    content: [
      {
        type: "text",
        text: buildResearchPrompt(interest, now, API_RESEARCH_TOOLS),
        cache_control: { type: "ephemeral" },
      },
    ],
  };
  const tools = webTools(
    deps.maxSearches ?? DEFAULT_MAX_SEARCHES,
    deps.maxFetches ?? DEFAULT_MAX_FETCHES,
    interest.settings?.searchLocale ?? null,
  );

  // Claude's turn so far, across continuations.
  const turn: ContentBlock[] = [];
  for (let request = 0; ; request++) {
    const body: MessagesRequest = {
      model: RESEARCH_MODEL,
      max_tokens: MAX_TOKENS,
      messages: turn.length
        ? [user, { role: "assistant", content: turn }]
        : [user],
      tools,
    };
    let res: MessagesResponse;
    try {
      res = await deps.claude.createMessage(body, signal);
    } catch (err) {
      if (signal.aborted)
        return missing(
          `timed out after ${Math.round(timeoutMs / 1000)} s`,
          false,
        );
      // An HTTP error carries its status: only a 5xx (not 529, overloaded)
      // is worth one more go. No status: the connection broke.
      const status = (err as { status?: unknown }).status;
      return missing(
        err instanceof Error ? err.message : String(err),
        typeof status !== "number" || (status >= 500 && status !== 529),
      );
    }
    addUsage(usage, res);
    turn.push(...res.content);

    if (res.stop_reason === "end_turn") break;
    if (res.stop_reason === "pause_turn") {
      if (usage.costUsd >= maxCostUsd)
        return missing(
          `stopped at the spend cap of ${maxCostUsd.toFixed(2)} USD`,
          false,
        );
      if (request < MAX_CONTINUATIONS) continue;
      return missing(
        `still paused after ${MAX_CONTINUATIONS} continuations`,
        false,
      );
    }
    if (res.stop_reason === "refusal") return missing("Claude refused", false);
    if (res.stop_reason === "max_tokens")
      return missing("the section was cut off at max_tokens", false);
    return missing(`unexpected stop reason: ${res.stop_reason}`, true);
  }

  // Tool errors come back inside a 200. Claude reads them and carries on, so
  // they only fail the session when no search or fetch worked at all: its
  // "No change since …" line would otherwise read as an honest empty topic.
  const toolErrors = turnToolErrors(turn);
  if (toolErrors.length && !usage.webSearches && !usage.webFetches)
    return missing(
      `web tools failed: ${toolErrors.join(", ")}`,
      !toolErrors.some((code) => LIMIT_TOOL_ERRORS.has(code)),
    );

  const section = sectionFromAnswer(finalText(turn), interest, now);
  if (!section) return missing("Claude returned no section", true);
  return { ...section, usage };
}

function emptyUsage(): ResearchUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    webFetches: 0,
    costUsd: 0,
  };
}

function addUsage(total: ResearchUsage, res: MessagesResponse): void {
  const u = res.usage;
  total.inputTokens += u.input_tokens;
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  total.webSearches += u.server_tool_use?.web_search_requests ?? 0;
  total.webFetches += u.server_tool_use?.web_fetch_requests ?? 0;
  total.costUsd += responseCostUsd(u);
}

// The answer is the text after Claude's last tool result: earlier text is its
// running commentary between searches. Citations split one answer into many
// text blocks, so they join with nothing between them.
function finalText(turn: ContentBlock[]): string {
  const lastTool = turn.findLastIndex(
    (b) => b.type === "server_tool_use" || b.type.endsWith("_tool_result"),
  );
  return turn
    .slice(lastTool + 1)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

// A failed web search or fetch: its result's content is one error object
// (`web_search_tool_result_error`, `web_fetch_tool_result_error`), not a list.
function turnToolErrors(turn: ContentBlock[]): string[] {
  return turn.flatMap((b) => {
    if (!b.type.endsWith("_tool_result")) return [];
    const c = b.content as { type?: unknown; error_code?: unknown } | null;
    if (c && typeof c.type === "string" && c.type.endsWith("_error"))
      return [String(c.error_code ?? c.type)];
    return [];
  });
}
