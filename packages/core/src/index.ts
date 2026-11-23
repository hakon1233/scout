// @scout/core: Scout's brief grammar and rules, as pure TypeScript. No Node,
// Deno or browser-only APIs and no imports outside this folder, so the web app,
// the companion and the hosted functions can all use it.

export type {
  AppPage,
  Brief,
  ChatChange,
  ChatConfirm,
  ChatTurn,
  CliUsage,
  Interest,
  PendingDelete,
  PendingCreate,
  PendingFeedback,
  PendingFollow,
  PendingRewrite,
  ScheduleRunStatus,
  ScheduleView,
  TopicBasis,
  TopicCoverage,
  TopicMode,
} from "./contract.ts";
export type {
  BriefLength,
  BriefSettings,
  InterestSettingsBody,
} from "./contract.ts";
export { PATHS, VOICE_USED_UP } from "./contract.ts";
export {
  BRIEF_SETTINGS_COLUMNS,
  DEFAULT_BRIEF_SETTINGS,
  MAX_STORIES,
  briefSettingsFromRow,
  briefSettingsOrDefault,
  briefSettingsToRow,
  parseBriefSettings,
  type BriefSettingsParse,
  type BriefSettingsRow,
} from "./brief-settings.ts";
export { plural, quotaMessage } from "./quota.ts";
export {
  HAIKU_MODEL,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_TOPIC_CHARS,
} from "./limits.ts";
export { quotedList } from "./quoted-list.ts";
export { SEARCH_SKILLS } from "./search-skills.ts";
export { ASSEMBLY_SKILLS } from "./assembly-skills.ts";
export {
  API_RESEARCH_TOOLS,
  CLI_RESEARCH_TOOLS,
  buildResearchPrompt,
  reportedStories,
  stripBriefPreamble,
  type PriorBrief,
  type ReportedBrief,
  type ResearchInterest,
  type ResearchTools,
} from "./research-prompt.ts";
export { RELEVANCE_SKILLS } from "./relevance-skills.ts";
export {
  MAX_SENT_KEYS,
  buildMakePrompt,
  makeSectionFromAnswer,
  pieceKey,
} from "./make-piece.ts";
export { APP_PAGES, SCOUT_GUIDE, appPage } from "./scout-guide.ts";
export {
  assembleBrief,
  computeCoverage,
  enforceBriefFreshness,
  extractTopicSection,
  mergeBriefSections,
  normalizeTopic,
} from "./coverage.ts";
export { sectionFromAnswer } from "./research-section.ts";
export {
  claimedRunFromRow,
  researchInterestOf,
  type ClaimedRun,
  type ClaimedRunRow,
} from "./claimed-run.ts";
export {
  TEAM_PATHS,
  type TeamRun,
  type TeamRunResult,
  type TeamTopic,
} from "./team.ts";
export {
  LOCAL_ACCOUNT_MESSAGE,
  RELAY_HEADER,
  RELAY_TOKEN_HEADER,
  parseRelayAnswer,
  type RelayAnswer,
  type RelayModelRequest,
  type RelayPrompt,
  type RelayStep,
  type TeamPicksClaim,
} from "./relay.ts";
export { canonicalUrl, parseBrief } from "./brief-document.ts";
export { createWeeklyBriefFromHistory } from "./weekly.ts";
export {
  cadenceInWords,
  planChatChanges,
  replayChanges,
  type ChatCadence,
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
  FEEDBACK_SCHEMA_PROPERTIES,
  FEEDBACK_SENT_REPLY,
  MAX_FEEDBACK_SUMMARY_CHARS,
  MAX_FEEDBACK_TEXT_CHARS,
  feedbackOf,
  type FeedbackKind,
} from "./feedback.ts";
export {
  buildChatPrompt,
  parseChatOutput,
  type ChatModelOutput,
} from "./chat-prompt.ts";
export {
  MAX_TAGS,
  SEED_TAGS,
  TAG_PATTERN,
  isSeedTag,
  normalizeTags,
} from "./tags.ts";
export {
  MAX_PUBLIC_TITLE,
  MAX_PUBLIC_URLS,
  PUBLISH_CHECK_SCHEMA,
  PUBLISH_PATH,
  buildPublishPrompt,
  parsePublishCheck,
  publishPrecheck,
  type PublishInput,
  type PublishRequest,
  type PublishResponse,
  type PublishVerdict,
} from "./publish-check.ts";
export {
  MAX_PICKS,
  MAX_PICK_REASON,
  PICKS_SCHEMA,
  PICKS_VERSION,
  buildPicksPrompt,
  parsePicks,
  pickKey,
  pickReasonGrounded,
  type Pick,
  type PicksInput,
  type PicksReader,
} from "./picks-prompt.ts";
