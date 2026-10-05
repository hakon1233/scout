// Progress types for the brief generation UI.
//
// Briefs are generated through the local companion (`refreshBriefViaCompanion`
// in ./companion); `AgentProgressPanel` and the app page render this progress
// shape while it runs.
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
