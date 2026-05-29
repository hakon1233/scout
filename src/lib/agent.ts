// Progress types for the brief generation UI.
//
// These used to back a browser→Exa execution path (`runAgent`) that fetched
// api.exa.ai and Anthropic directly from the page. That path was CORS-broken
// and was removed in PER-109 — Scout now generates briefs exclusively through
// the local companion (`refreshBriefViaCompanion` in ./companion). The
// progress shape is kept because `AgentProgressPanel` and the app page still
// render it while the companion synthesizes.
import type { Article } from "./types";

export type InterestState = "pending" | "searching" | "done" | "failed";

export type PerInterestProgress = {
  topic: string;
  state: InterestState;
  resultCount?: number;
};

export type AgentProgress = {
  stage: "searching" | "synthesizing" | "done" | "error";
  message: string;
  articles?: Article[];
  perInterest: PerInterestProgress[];
};
