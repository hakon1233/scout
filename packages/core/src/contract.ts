// The companion's HTTP contract: every JSON shape and path that crosses
// between the web app and the companion. The web app imports this file (as
// `@scout/agent/contract`), so it must stay browser-safe: types and constants
// only, no Node imports.

// What the hosted Worker's POST /voice answers (429) at any voice limit, and
// what the web app shows: voice has no paid fallback.
export const VOICE_USED_UP = "Voice is used up for today. Type instead.";

// Paths the companion serves. Everything else is the static web app.
export const PATHS = {
  health: "/healthz",
  version: "/v0/version",
  config: "/v0/config",
  interests: "/v0/interests",
  briefs: "/v0/briefs",
  weeklyBrief: "/v0/weekly-brief",
  schedule: "/v0/schedule",
  chat: "/v0/chat",
  chatStop: "/v0/chat/stop",
  chatConfirmDelete: "/v0/chat/confirm-delete",
  chatConfirmRewrite: "/v0/chat/confirm-rewrite",
  interestSettings: "/v0/interest-settings",
} as const;

// Something the reader wants news about. `id` is stable and opaque (it names
// the interest's intent doc on disk and survives renames); `topic` is the
// short headline that also heads the interest's section in a brief.
export type Interest = {
  id: string;
  topic: string;
};

// How one interest's section reads (brief-settings.ts reads and checks it).
//   length       — short: lead paragraph only; normal: 1-3 paragraphs per
//                  story; long: 3-5.
//   stories      — at most this many stories (1..MAX_STORIES), or "relevant":
//                  only the stories that clearly match the intent doc.
//   evergreen    — older background is welcome: no 30-day cutoff.
//   searchLocale — BCP 47 tag of where to search ("nb-NO", "de"); null: anywhere.
//   briefLanguage — language to write in ("en", "nb"); null: the intent doc's.
export type BriefLength = "short" | "normal" | "long";
export type BriefSettings = {
  length: BriefLength;
  stories: number | "relevant";
  evergreen: boolean;
  searchLocale: string | null;
  briefLanguage: string | null;
};

// PUT /v0/interest-settings: change one interest's brief settings. Fields
// left out keep their stored value. The answer is the same shape with the
// whole settings as stored. GET /v0/interests carries each one's `settings`.
export type InterestSettingsBody = {
  interestId: string;
  settings: Partial<BriefSettings>;
};

// Per-topic outcome of a run:
//   covered — the section has at least one cited story;
//   empty   — the model found no fresh news (an honest "nothing", not an error);
//   missing — the session failed or the section was dropped (worth a retry).
type TopicStatus = "covered" | "empty" | "missing";
export type TopicCoverage = { topic: string; status: TopicStatus };

// The exact topic and intent doc one section's research used, kept with the
// brief so the reader sees what produced it even after editing the doc.
export type TopicBasis = {
  topic: string;
  doc: string;
};

// What `claude` CLI sessions reported using (`--output-format json`),
// summed over a run's sessions. Subscription sessions spend no API dollars:
// costUsd is the CLI's own estimate at API prices. webFetches is null when the
// CLI did not report it (its WebFetch runs locally, not as a server tool).
export type CliUsage = {
  // The model that wrote the answer (the one with the most output tokens).
  model: string | null;
  stopReason: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number | null;
  costUsd: number;
};

export type Brief = {
  id: string;
  generated_at: string;
  status: "pending" | "ready" | "failed";
  // A test or dry run: pollable by its caller, never shown as the reader's
  // real edition.
  ephemeral?: boolean;
  // Absent on old briefs, which count as daily.
  kind?: "daily" | "weekly";
  summary_md?: string;
  error_msg?: string;
  // Coverage over the full interest list; absent on old briefs.
  topics?: TopicCoverage[];
  // Absent on old briefs and on pending or failed ones.
  bases?: TopicBasis[];
  // What the run's sessions used, summed. Absent on old briefs and when no
  // session reported usage.
  usage?: CliUsage;
};

// One change a chat turn applied. `interestId` is the concrete id the change
// landed on (server-minted for a create).
export type ChatChange = {
  interestId: string;
  op: "create" | "update" | "delete";
  // The (possibly renamed) topic; absent on delete.
  topic?: string;
  // The full doc as persisted; absent on delete.
  doc?: string;
  // On a create: the cadence the reader asked for, which the client sets
  // when a slot is free. Absent: the first free slot.
  cadence?: "daily" | "weekly";
  // On a create: "make" when Scout writes the piece itself (a bedtime story,
  // a word of the day). Absent: news. Hosted chat only, while `make_on` is on.
  mode?: "make";
};

// How a topic's runs work: "news" researches the web, "make" has Scout write
// one piece itself with no web tools (core's make-piece.ts).
export type TopicMode = "news" | "make";

// A delete a turn proposed but did not apply. It waits for
// POST /v0/chat/confirm-delete; until then the interest stays.
export type PendingDelete = {
  interestId: string;
  topic: string;
};

// A full rewrite of an intent doc a turn proposed but did not apply. It waits
// for POST /v0/chat/confirm-rewrite, which writes the server's stored copy of
// `doc` (never one echoed back by the client).
export type PendingRewrite = {
  interestId: string;
  topic: string;
  doc: string;
};

// A public interest a turn offered to follow instead of creating a near copy.
// It waits for the reader's confirm. Hosted chat only.
export type PendingFollow = {
  interestId: string;
  topic: string;
};

// A new topic a hosted turn proposed but did not save. It waits for the
// reader's confirm, which saves the stored copy under the minted id. Hosted
// chat only; the companion's chat still creates at once.
export type PendingCreate = {
  interestId: string;
  topic: string;
  doc: string;
  cadence?: "daily" | "weekly";
  mode?: "make";
};

// A note to the Scout team a hosted turn drafted but did not send. It waits for
// the reader's confirm, which sends the stored copy (core's feedback.ts).
// Hosted chat only, and only while the `feedback_on` setting is on.
export type PendingFeedback = {
  kind: "bug" | "wish" | "other";
  // One line for the card's header.
  summary: string;
  text: string;
};

// The hosted Worker's POST /chat/confirm body: which proposal of the reader's
// last chat turn they accept. The Worker checks it against the stored turn.
export type ChatConfirm =
  | { kind: "delete"; interestIds: string[] }
  | { kind: "rewrite"; interestId: string }
  | { kind: "follow"; interestId: string }
  | { kind: "create"; interestId: string }
  | { kind: "feedback" };

// One chat turn. Kicked with POST /v0/chat and polled with GET /v0/chat, like
// a brief run. A `ready` turn's `changes` are already on disk.
export type ChatTurn = {
  id: string;
  created_at: string;
  status: "pending" | "ready" | "failed";
  message: string;
  reply?: string;
  // Applied changes; [] when the turn only answered. Never holds a delete or a
  // full rewrite from the model: those arrive as pending proposals.
  changes?: ChatChange[];
  // Every delete the turn proposed, confirmed together. `pending_delete` is the
  // first of them, kept for clients that read only one.
  pending_deletes?: PendingDelete[];
  pending_delete?: PendingDelete;
  pending_rewrite?: PendingRewrite;
  pending_follows?: PendingFollow[];
  pending_creates?: PendingCreate[];
  pending_feedback?: PendingFeedback;
  // A page of the app the reply offers to open (core's APP_PAGES).
  page?: AppPage;
  error_msg?: string;
};

// The app pages a chat reply may link to. Labels live in scout-guide.ts.
export type AppPage =
  | "/app/topics/"
  | "/app/browse/"
  | "/app/profile/"
  | "/app/settings/"
  | "/app/upgrade/";

// Outcome of the last scheduled run: success (a brief landed), failed, or
// skipped (a run was already in flight, or there were no interests).
export type ScheduleRunStatus = "success" | "failed" | "skipped";

// GET and PUT /v0/schedule.
export type ScheduleView = {
  enabled: boolean;
  // Local "HH:MM" (24h) the daily run fires at.
  time_of_day: string;
  last_run_at: string | null;
  last_run_status: ScheduleRunStatus | null;
  last_run_note: string | null;
  next_run_at: string | null;
  // Whether launchd will restart the companion after a reboot.
  reboot_durable: boolean;
};
