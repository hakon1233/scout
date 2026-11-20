// The hosted data module's public types: what HostedData returns and takes,
// and HostedError, the one failure screens catch. src/lib/hosted.ts re-exports
// them; the area modules beside this file build HostedData from them.

import type {
  BriefSettings,
  ChatConfirm,
  ChatTurn,
  PublishResponse,
  TopicCoverage,
} from "@scout/core";
import type { Brief } from "../types";

export type Cadence = "daily" | "weekly" | "off";
// private: the owner's only. shared: anyone with the link may follow.
// public: in the catalog, readable signed out. Only Scout's server publishes
// (after its check); the web app sets private or shared.
export type Visibility = "private" | "shared" | "public";

export type HostedInterest = {
  id: string;
  topic: string;
  cadence: Cadence;
  // How its brief section is written (length, story count, locale...).
  settings: BriefSettings;
  // Someone else's shared or public interest the reader follows: no schedule
  // of its own to set, no run-now and no sharing, only unfollow.
  following: boolean;
  visibility: Visibility;
  // The link's slug while shared or public; null when private.
  shareSlug: string | null;
  // Its catalog tags while public (made by the publish check, then the
  // owner's); empty otherwise.
  tags: string[];
  // A run waiting in the queue or being researched now.
  run: "queued" | "running" | null;
  // When the latest brief section for it was written, or null for none yet.
  updatedAt: string | null;
  // Set when the newest run failed and nothing newer is ready: why, for the reader.
  failed: string | null;
  // A followed topic's owner, from its topic card: their display name (null
  // when they have none) and whether it is the Scout team. The "Scout team"
  // label comes from `team`, never from the name.
  ownerName: string | null;
  team: boolean;
};

export type Allowance = {
  plan: string;
  daily: { used: number; limit: number };
  weekly: { used: number; limit: number };
  runsToday: { used: number; limit: number };
};

export type HostedHome = {
  interests: HostedInterest[];
  // The latest section of every interest, as one brief. Null before the first.
  brief: Brief | null;
  allowance: Allowance;
  // May make an interest public.
  isAdmin: boolean;
  // Unread notices about topics: a followed one its host unshared, deleted or
  // stopped (each may be hosted as the reader's own), or one Scout hid.
  notices: Notice[];
};

export type NoticeKind = "hidden" | "stopped" | "unshared" | "deleted";

/** A topic went away or stopped. `reason` is set on the owner's own
 *  "hidden" notice; a hidden topic has no copy to host. */
export type Notice = {
  id: string;
  kind: NoticeKind;
  topic: string;
  reason: string | null;
  createdAt: string;
};

/** What a share link shows. `brief` is the interest's latest, or null. */
export type SharedInterest = {
  id: string;
  topic: string;
  visibility: Visibility;
  owned: boolean;
  following: boolean;
  // A Scout team topic (the topic card's flag); search engines index only
  // public team topics (lib/seo.ts).
  team: boolean;
  brief: Brief | null;
};

export interface HostedData {
  home(): Promise<HostedHome>;
  // The reader's recent chat turns, oldest first.
  transcript(): Promise<ChatTurn[]>;
  chat(message: string): Promise<ChatTurn>;
  confirm(action: ChatConfirm): Promise<ChatTurn>;
  // A recorded clip as text for the chat input (the Worker's POST /voice).
  // At a voice limit it throws a `limit` HostedError saying to type instead.
  transcribe(audio: Blob): Promise<string>;
  // A new paused topic of the reader's own with this intent doc; its id.
  createTopic(topic: string, doc: string): Promise<string>;
  setCadence(interestId: string, cadence: Cadence): Promise<void>;
  // Changes only the given fields; the next run uses them.
  setBriefSettings(
    interestId: string,
    change: Partial<BriefSettings>,
  ): Promise<void>;
  // Soft delete, and its undo.
  remove(interestId: string): Promise<void>;
  restore(interestId: string): Promise<void>;
  unfollow(interestId: string): Promise<void>;
  runNow(interestId: string): Promise<void>;
  // Private or shared; returns the share slug, or null once private.
  setVisibility(
    interestId: string,
    visibility: Visibility,
  ): Promise<string | null>;
  // A share link's interest and latest brief, signed in or out. Null when the
  // link is unknown or no longer shared.
  shared(slug: string): Promise<SharedInterest | null>;
  // Follow from a share link. Returns the interest id.
  follow(slug: string): Promise<string>;
  // "Host it yourself": the notice's interest as the reader's own, paused and
  // private, within their limits. Returns the new interest id.
  hostCopy(noticeId: string): Promise<string>;
  dismiss(noticeId: string): Promise<void>;
  // The reader's saved time zone (IANA name), or null when never set; and
  // Settings' change to it.
  timeZone(): Promise<string | null>;
  setTimeZone(timeZone: string): Promise<void>;
  // "Notify me about this topic": push for one interest, owned or followed.
  // Off by default; topics with it off come in the Monday digest instead.
  // topicPush lists the topic ids with it on.
  topicPush(): Promise<string[]>;
  setTopicPush(interestId: string, on: boolean): Promise<void>;
  // Deletes the account: topics first (followers are told), then the user.
  deleteAccount(): Promise<void>;
  // "Notify me when a brief is ready" on this device.
  pushStatus(): Promise<PushState>;
  // Call from the tap itself: browsers ask permission only in a user gesture.
  pushEnable(): Promise<PushState>;
  pushDisable(): Promise<PushState>;
  // Scout's publish check on one of the reader's topics (the Worker). A
  // refusal is a result, not an error; a limit is a HostedError "limit".
  publish(interestId: string): Promise<PublishResponse>;
  // The owner's tags on a public topic, without a new check. Returns them
  // cleaned (lower case, no repeats, at most 5).
  setTags(interestId: string, tags: string[]): Promise<string[]>;
  // The public catalog, signed in or out.
  browse(query?: BrowseQuery): Promise<TopicCard[]>;
  // Each tag in the catalog with its number of topics, most first.
  tagCounts(): Promise<{ tag: string; topics: number }[]>;
  // Report a public or link-shared topic; once per topic.
  report(interestId: string, reason: string): Promise<void>;
  profile(): Promise<Profile>;
  // Changes only the given fields. A reserved display name is refused.
  setProfile(change: Partial<Profile>): Promise<void>;
  // The reader's liked or saved stories, newest first.
  marks(kind: MarkKind): Promise<StoryMark[]>;
  mark(kind: MarkKind, mark: Omit<StoryMark, "createdAt">): Promise<void>;
  unmark(kind: MarkKind, storyKey: string): Promise<void>;
  // Usage events, sent in batches of at most MAX_EVENT_BATCH.
  sendEvents(events: UsageEvent[]): Promise<void>;
  // Up to 5 public topics picked for the signed-in reader, best first, each
  // with a one-line reason. Refreshed weekly and after a profile change.
  picks(): Promise<PickCard[]>;
  // "Not for me": the topic is never picked for this reader again.
  dismissPick(interestId: string): Promise<void>;
}

/** A topic picked for the reader (the SQL's my_picks). */
export type PickCard = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  ownerName: string | null;
  team: boolean;
  reason: string;
};

export type BrowseQuery = {
  q?: string;
  tags?: string[];
  sort?: "popular" | "new";
  limit?: number; // at most 50
  offset?: number;
};

/** A public topic's card (the SQL's topic_card) as browse returns it. */
export type TopicCard = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  ownerName: string | null;
  team: boolean;
  followers: number;
  briefs: {
    id: string;
    section_md: string | null;
    coverage: TopicCoverage | null;
    finished_at: string | null;
  }[];
};

export type Profile = {
  displayName: string | null;
  location: string | null;
  student: boolean | null;
  role: string | null;
  likedTags: string[];
};

export type MarkKind = "like" | "save";
export type StoryMark = {
  storyKey: string; // the story's URL, or its title when it has none
  interestId: string | null;
  story: Record<string, unknown> | null; // a small copy to show (≤ 4 KB)
  createdAt: string;
};

export type UsageEvent =
  | {
      kind: "story_click";
      interestId: string;
      runId?: string;
      storyKey: string;
    }
  | { kind: "brief_view"; interestId: string; runId?: string }
  | {
      kind: "story_seconds";
      interestId: string;
      runId?: string;
      storyKey: string;
      seconds: number;
    };

export const MAX_EVENT_BATCH = 50;

/** Push on this device: `needs-install` is an iPhone outside the Home Screen
 *  (iOS 16.4+ pushes only to installed web apps). */
export type PushState =
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

export type PushKeys = { endpoint: string; p256dh: string; auth: string };

/** The browser's push side, injected so tests need no browser. */
export interface PushDevice {
  supported: boolean;
  needsInstall: boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  subscription(): Promise<PushKeys | null>;
  subscribe(applicationServerKey: string): Promise<PushKeys>;
  // Returns the endpoint it dropped, if there was one.
  unsubscribe(): Promise<string | null>;
}

/** A failure with a message the page can show as is. `limit` means the
 *  reader's plan said no; `signed-out` means the session is gone. */
export class HostedError extends Error {
  override name = "HostedError";
  constructor(
    readonly kind: "limit" | "signed-out" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export type Session = { userId: string; accessToken: string };
