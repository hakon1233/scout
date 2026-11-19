// @scout/research: one interest's research through the Claude API, and the
// Claude client seam and price table every hosted function shares. Server-side only; the web app never imports it.

export {
  researchInterest,
  RESEARCH_MODEL,
  type ResearchDeps,
  type ResearchResult,
  type ResearchUsage,
} from "./research-interest.ts";
export {
  anthropicClient,
  recordedClient,
  type ClaudeClient,
  type MessagesRequest,
  type MessagesResponse,
  type Usage,
} from "./claude-client.ts";
export { HAIKU_PRICES, responseCostUsd } from "./pricing.ts";
