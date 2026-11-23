// What one Messages API response costs in USD, from its `usage`. One table:
// change prices here only.

import type { Usage } from "./claude-client.ts";

// Claude Haiku 5.5 list prices, USD (November 2026). Above 100K prompt tokens
// the whole request is billed at the long-prompt rates.
export const HAIKU_PRICES = {
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  longInputPerMTok: 0.5,
  longOutputPerMTok: 2.5,
  longPromptAboveTokens: 100_000,
  cacheReadMultiplier: 0.1, // of the input rate
  cacheWriteMultiplier: 1.25, // 5-minute cache writes, of the input rate
  perWebSearch: 0.01, // $10 per 1,000; failed searches are free
  // Web fetch has no per-call fee: fetched pages are billed as input tokens.
} as const;

// One response's whole prompt: fresh input plus cache reads and writes.
export function promptTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

// The input and output tokens of one call, for the ledgers that keep them
// next to its cost (chat turns, picks, publish checks).
export type TokenCount = { inputTokens: number; outputTokens: number };

export function tokenCount(usage: Usage): TokenCount {
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

// The cost of one response. `usage` sums every server-side sampling step in
// that response, so the long-prompt test runs on the sum: an over-estimate
// when single steps stayed under 100K but their sum didn't.
export function responseCostUsd(usage: Usage, p = HAIKU_PRICES): number {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const long = promptTokens(usage) > p.longPromptAboveTokens;
  const inRate = (long ? p.longInputPerMTok : p.inputPerMTok) / 1e6;
  const outRate = (long ? p.longOutputPerMTok : p.outputPerMTok) / 1e6;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    usage.input_tokens * inRate +
    cacheRead * inRate * p.cacheReadMultiplier +
    cacheWrite * inRate * p.cacheWriteMultiplier +
    usage.output_tokens * outRate +
    searches * p.perWebSearch
  );
}
