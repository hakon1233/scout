// @scout/core: Scout's brief grammar and rules, as pure TypeScript. No Node,
// Deno or browser-only APIs and no imports outside this folder, so the web app,
// the companion and the hosted functions can all use it.

export type {
  Brief,
  ChatChange,
  ChatConfirm,
  ChatTurn,
  Interest,
  PendingDelete,
  PendingFollow,
  PendingRewrite,
  ScheduleRunStatus,
  ScheduleView,
  TopicBasis,
  TopicCoverage,
} from "./contract.ts";
export { PATHS } from "./contract.ts";
export { plural, quotaMessage } from "./quota.ts";
export { SEARCH_SKILLS } from "./search-skills.ts";
export { ASSEMBLY_SKILLS } from "./assembly-skills.ts";
export {
  API_RESEARCH_TOOLS,
  CLI_RESEARCH_TOOLS,
  buildResearchPrompt,
  stripBriefPreamble,
  type ResearchInterest,
  type ResearchTools,
} from "./research-prompt.ts";
export {
  assembleBrief,
  computeCoverage,
  enforceBriefFreshness,
  extractTopicSection,
  interestWantsEvergreen,
  mergeBriefSections,
  normalizeTopic,
} from "./coverage.ts";
export { sectionFromAnswer } from "./research-section.ts";
export {
  TEAM_PATHS,
  type TeamRun,
  type TeamRunResult,
  type TeamTopic,
} from "./team.ts";
export { canonicalUrl, parseBrief } from "./brief-document.ts";
export { createWeeklyBriefFromHistory } from "./weekly.ts";
export {
  planChatChanges,
  replayChanges,
  type ChatChangeLimits,
  type ChatChangePlan,
  type InterestSnapshot,
  type ProposedChange,
} from "./chat-changes.ts";
export {
  chatTurnFromRow,
  chatTurnToRow,
  type ChatTurnRow,
} from "./chat-rows.ts";
export {
  buildChatPrompt,
  parseChatOutput,
  type ChatModelOutput,
} from "./chat-prompt.ts";
