// @scout/research: one interest's research through the Claude API, for the
// hosted functions. Server-side only; the web app never imports it.

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
} from "./claude-client.ts";
