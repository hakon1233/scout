// The hosted app's data: the signed-in reader's interests, their latest brief,
// their plan's allowance, the setup chat, run-now and sharing (links, follows,
// and the notice when a host stops sharing), publishing and the catalog
// (browse, tags, reports), the reader's profile, likes and saves, and usage
// events. The one module hosted screens call; components never fetch or touch
// Supabase themselves. A share link (`shared`) and browse also work signed out.
//
// Reads and the reader's own edits go to Supabase's REST API as the reader
// (their JWT, so RLS and the quota trigger apply). The chat and run-now go to
// the Worker (packages/worker), which verifies the same JWT. Plain fetch: only
// auth.ts holds supabase-js. Errors reach callers as a HostedError whose
// message is written for the reader.

import {
  assembleBrief,
  BRIEF_SETTINGS_COLUMNS,
  type BriefSettings,
  type BriefSettingsRow,
  briefSettingsFromRow,
  briefSettingsToRow,
  parseBriefSettings,
  type ChatConfirm,
  type ChatTurn,
  type ChatTurnRow,
  type TopicCoverage,
  chatTurnFromRow,
  plural,
  PUBLISH_PATH,
  type PublishResponse,
  quotaMessage,
  VOICE_USED_UP,
} from "@scout/core";
import { hostedAuth, hostedConfig } from "./auth";
import { parseArticlesFromMarkdown } from "./companion";
import { createFakeHostedData, fakeHostedOn } from "./hosted-fake";
import {
  followLikes,
  followSaves,
  type LikedStory,
  type LikesSync,
} from "./likes";
import type { Brief } from "./types";

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

type PushKeys = { endpoint: string; p256dh: string; auth: string };

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

type Fetch = typeof fetch;
const TRANSCRIPT_TURNS = 30;
const RUN_HISTORY = 200;

export function createHostedData(deps: {
  supabaseUrl: string;
  anonKey: string;
  workerUrl: string;
  session: () => Promise<Session | null>;
  fetch?: Fetch;
  push?: PushDevice;
  vapidKey?: string; // the Worker's VAPID public key, base64url
}): HostedData {
  const doFetch: Fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));

  async function session(): Promise<Session> {
    const s = await deps.session();
    if (!s) throw new HostedError("signed-out", "Sign in to see your briefs.");
    return s;
  }

  async function call(
    url: string,
    init: {
      method: string;
      body?: unknown;
      prefer?: string;
      keepalive?: boolean;
    },
    s: Session,
    apikey = true,
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${s.accessToken}`,
    };
    if (apikey) headers.apikey = deps.anonKey;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.prefer) headers.prefer = init.prefer;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        ...(init.keepalive ? { keepalive: true } : {}),
      });
    } catch {
      throw new HostedError(
        "failed",
        apikey
          ? "Scout can't be reached. Check your connection and try again."
          : "Scout's server can't be reached right now. Try again later.",
      );
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.status === 401)
      throw new HostedError("signed-out", "Your session ended. Sign in again.");
    return { status: res.status, body };
  }

  async function rest<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      prefer?: string;
      // Lets the request finish after the page is gone (usage on pagehide).
      keepalive?: boolean;
    } = {},
    // Signed out, the anon key stands in for the session (public reads only).
    signedOutOk = false,
  ): Promise<T> {
    const s = signedOutOk
      ? ((await deps.session()) ?? { userId: "", accessToken: deps.anonKey })
      : await session();
    const { status, body } = await call(
      `${deps.supabaseUrl}/rest/v1/${path}`,
      {
        method: init.method ?? "GET",
        body: init.body,
        prefer: init.prefer,
        keepalive: init.keepalive,
      },
      s,
    );
    if (status >= 400) throw restError(body);
    return body as T;
  }

  async function worker(path: string, payload: unknown): Promise<unknown> {
    if (!deps.workerUrl)
      throw new HostedError("failed", "This build has no Scout server set up.");
    const s = await session();
    const { status, body } = await call(
      `${deps.workerUrl}${path}`,
      { method: "POST", body: payload },
      s,
      false,
    );
    if (status < 400) return body;
    const b = body as { error?: string; message?: string } | null;
    const said = b?.message ?? b?.error ?? "";
    if (status === 429)
      throw new HostedError("limit", workerLimitMessage(path, said));
    // The publish route's other refusals are written for the reader.
    if (path === PUBLISH_PATH && said && status !== 502)
      throw new HostedError("failed", said);
    if (status === 409)
      throw new HostedError(
        "failed",
        "That was already settled. Send a new message.",
      );
    throw new HostedError("failed", "Something went wrong. Try again.");
  }

  // Followed topics' owners, from each one's topic card (profiles are
  // private, so the card is the only place a name shows). A card that fails
  // to load leaves the owner unnamed.
  async function ownersOf(
    followed: InterestRow[],
  ): Promise<Map<string, { ownerName: string | null; team: boolean }>> {
    const cards = await Promise.all(
      followed
        .filter((r) => r.share_slug)
        .map((r) =>
          rest<TopicCardRow | null>("rpc/interest_by_slug", {
            method: "POST",
            body: { p_slug: r.share_slug },
          }).catch(() => null),
        ),
    );
    return new Map(
      cards
        .filter((c): c is TopicCardRow => c !== null)
        .map((c) => [
          c.id,
          { ownerName: c.owner_name ?? null, team: c.team === true },
        ]),
    );
  }

  async function patchInterest(id: string, fields: Record<string, unknown>) {
    await rest(`interests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: fields,
      prefer: "return=minimal",
    });
  }

  async function pushStatus(): Promise<PushState> {
    const p = deps.push;
    if (!p || !deps.vapidKey) return "unsupported";
    if (!p.supported) return p.needsInstall ? "needs-install" : "unsupported";
    if (p.permission() === "denied") return "denied";
    return (await p.subscription()) ? "on" : "off";
  }

  return {
    pushStatus,

    async pushEnable() {
      const p = deps.push;
      const key = deps.vapidKey;
      if (!p || !key || !p.supported) return pushStatus();
      // Nothing awaited before the prompt: Safari asks only within the tap.
      const granted =
        p.permission() === "granted" ||
        (await p.requestPermission()) === "granted";
      if (!granted) return pushStatus();
      let keys: PushKeys;
      try {
        keys = await p.subscribe(key);
      } catch {
        throw new HostedError(
          "failed",
          "This browser wouldn't turn on notifications. Try again.",
        );
      }
      try {
        await rest("rpc/save_push_subscription", {
          method: "POST",
          body: {
            p_endpoint: keys.endpoint,
            p_p256dh: keys.p256dh,
            p_auth: keys.auth,
          },
        });
      } catch (e) {
        await p.unsubscribe().catch(() => null);
        throw e;
      }
      return "on";
    },

    async pushDisable() {
      const p = deps.push;
      const endpoint = p ? await p.unsubscribe() : null;
      if (endpoint && (await deps.session())) {
        await rest(
          `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
          { method: "DELETE", prefer: "return=minimal" },
        );
      }
      return pushStatus();
    },

    async home() {
      const s = await session();
      const user = encodeURIComponent(s.userId);
      const [own, follows, allowance, profile, notices] = await Promise.all([
        rest<InterestRow[]>(
          `interests?select=${INTEREST_COLUMNS}&owner_id=eq.${user}&deleted_at=is.null&order=created_at.asc`,
        ),
        rest<{ interests: InterestRow | null }[]>(
          `follows?select=interests(${INTEREST_COLUMNS})&user_id=eq.${user}&order=created_at.asc`,
        ),
        rest<AllowanceRow>("rpc/allowance", {
          method: "POST",
          body: { p_user: s.userId },
        }),
        rest<{ is_admin: boolean; timezone_set: boolean }[]>(
          `profiles?select=is_admin,timezone_set&id=eq.${user}`,
        ),
        rest<NoticeRow[]>(
          `notifications?select=id,kind,payload,created_at&user_id=eq.${user}&kind=in.(hidden,stopped,unshared,deleted)&read_at=is.null&order=created_at.desc`,
        ),
      ]);
      // First sign-in: the browser's time zone, once. Later only Settings.
      if (profile[0] && !profile[0].timezone_set) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz)
          await rest("rpc/set_timezone", {
            method: "POST",
            body: { p_tz: tz, p_first_time: true },
          }).catch(() => null);
      }
      const rows: (InterestRow & { following: boolean })[] = [
        ...own.map((i) => ({ ...i, following: false })),
        ...follows
          .map((f) => f.interests)
          .filter((i): i is InterestRow => i !== null)
          .map((i) => ({ ...i, cadence: "off" as Cadence, following: true })),
      ];
      const runs =
        rows.length === 0
          ? []
          : await rest<RunRow[]>(
              `runs?select=id,interest_id,status,section_md,coverage,error_msg,created_at,finished_at&interest_id=in.(${rows
                .map((r) => encodeURIComponent(r.id))
                .join(",")})&order=created_at.desc&limit=${RUN_HISTORY}`,
            );
      const owners = await ownersOf(rows.filter((r) => r.following));
      const assembled = assembleHome(rows, runs, allowance);
      return {
        ...assembled,
        interests: assembled.interests.map((i) => ({
          ...i,
          ...owners.get(i.id),
        })),
        isAdmin: profile[0]?.is_admin === true,
        notices: notices.map((n) => ({
          id: n.id,
          kind: n.kind,
          topic: n.payload?.topic ?? "A topic",
          reason: n.payload?.reason ?? null,
          createdAt: n.created_at,
        })),
      };
    },

    async transcript() {
      const s = await session();
      const rows = await rest<ChatTurnRow[]>(
        `chat_turns?select=id,created_at,status,message,reply,changes,pending,error_msg&user_id=eq.${encodeURIComponent(s.userId)}&status=neq.pending&order=created_at.desc&limit=${TRANSCRIPT_TURNS}`,
      );
      return rows.reverse().map(chatTurnFromRow);
    },

    async chat(message) {
      return (await worker("/chat", { message })) as ChatTurn;
    },

    async confirm(action) {
      return (await worker("/chat/confirm", action)) as ChatTurn;
    },

    async transcribe(audio) {
      if (!deps.workerUrl)
        throw new HostedError(
          "failed",
          "This build has no Scout server set up.",
        );
      const s = await session();
      let res: Response;
      try {
        res = await doFetch(`${deps.workerUrl}/voice`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.accessToken}`,
            "content-type": audio.type || "audio/webm",
          },
          body: audio,
        });
      } catch {
        throw new HostedError(
          "failed",
          "Scout's server can't be reached right now. Type instead.",
        );
      }
      const body = (await res.json().catch(() => null)) as {
        text?: string;
        error?: string;
      } | null;
      if (res.ok && typeof body?.text === "string") return body.text;
      if (res.status === 401)
        throw new HostedError(
          "signed-out",
          "Your session ended. Sign in again.",
        );
      if (res.status === 429) throw new HostedError("limit", VOICE_USED_UP);
      throw new HostedError(
        "failed",
        body?.error ?? "Voice isn't working right now. Type instead.",
      );
    },

    async setCadence(interestId, cadence) {
      await patchInterest(interestId, { cadence });
    },

    async setBriefSettings(interestId, change) {
      const parsed = parseBriefSettings(change);
      if (!parsed.ok) throw new HostedError("failed", parsed.error);
      await patchInterest(interestId, briefSettingsToRow(change));
    },

    async remove(interestId) {
      await patchInterest(interestId, { deleted_at: new Date().toISOString() });
    },

    async restore(interestId) {
      await patchInterest(interestId, { deleted_at: null });
    },

    async unfollow(interestId) {
      const s = await session();
      await rest(
        `follows?user_id=eq.${encodeURIComponent(s.userId)}&interest_id=eq.${encodeURIComponent(interestId)}`,
        { method: "DELETE", prefer: "return=minimal" },
      );
    },

    async runNow(interestId) {
      await worker("/runs", { interestId });
    },

    async setVisibility(interestId, visibility) {
      if (visibility === "public")
        throw new HostedError(
          "failed",
          "Publishing goes through Scout's check. Share the link instead.",
        );
      return await rest<string | null>("rpc/set_sharing", {
        method: "POST",
        body: { p_interest: interestId, p_visibility: visibility },
      });
    },

    async shared(slug) {
      const row = await rest<SharedRow | null>(
        "rpc/interest_by_slug",
        { method: "POST", body: { p_slug: slug } },
        true,
      );
      if (!row) return null;
      const run = row.run;
      return {
        id: row.id,
        topic: row.topic,
        visibility: row.visibility,
        owned: row.owned,
        following: row.following,
        brief: run?.section_md
          ? briefFrom(
              [{ topic: row.topic, section: run.section_md }],
              run.coverage ? [run.coverage] : [],
              { id: run.id, at: run.finished_at ?? "" },
            )
          : null,
      };
    },

    async follow(slug) {
      return await rest<string>("rpc/follow", {
        method: "POST",
        body: { p_slug: slug },
      });
    },

    async hostCopy(noticeId) {
      return await rest<string>("rpc/host_copy", {
        method: "POST",
        body: { p_notification: noticeId },
      });
    },

    async dismiss(noticeId) {
      await rest(`notifications?id=eq.${encodeURIComponent(noticeId)}`, {
        method: "PATCH",
        body: { read_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
    },

    async timeZone() {
      const s = await session();
      const rows = await rest<{ timezone: string | null }[]>(
        `profiles?select=timezone&id=eq.${encodeURIComponent(s.userId)}`,
      );
      return rows[0]?.timezone ?? null;
    },

    async setTimeZone(timeZone) {
      await rest("rpc/set_timezone", {
        method: "POST",
        body: { p_tz: timeZone },
      });
    },

    async topicPush() {
      const s = await session();
      const user = encodeURIComponent(s.userId);
      const [own, follows] = await Promise.all([
        rest<{ id: string }[]>(
          `interests?select=id&owner_id=eq.${user}&deleted_at=is.null&push_enabled=is.true`,
        ),
        rest<{ interest_id: string }[]>(
          `follows?select=interest_id&user_id=eq.${user}&push_enabled=is.true`,
        ),
      ]);
      return [...own.map((r) => r.id), ...follows.map((r) => r.interest_id)];
    },

    async setTopicPush(interestId, on) {
      await rest("rpc/set_topic_push", {
        method: "POST",
        body: { p_interest: interestId, p_on: on },
      });
    },

    async deleteAccount() {
      await worker("/account/delete", {});
    },

    async publish(interestId) {
      return (await worker(PUBLISH_PATH, {
        interest: interestId,
      })) as PublishResponse;
    },

    async setTags(interestId, tags) {
      return await rest<string[]>("rpc/set_topic_tags", {
        method: "POST",
        body: { p_interest: interestId, p_tags: tags },
      });
    },

    async browse(query = {}) {
      const rows = await rest<TopicCardRow[]>(
        "rpc/browse_topics",
        {
          method: "POST",
          body: {
            p_q: query.q?.trim() || null,
            p_tags: query.tags?.length ? query.tags : null,
            p_sort: query.sort ?? "popular",
            p_limit: Math.min(query.limit ?? 24, 50),
            p_offset: query.offset ?? 0,
          },
        },
        true,
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        tags: r.tags ?? [],
        ownerName: r.owner_name,
        team: r.team,
        followers: r.followers ?? 0,
        briefs: r.briefs ?? [],
      }));
    },

    async tagCounts() {
      return await rest<{ tag: string; topics: number }[]>(
        "rpc/tag_counts",
        { method: "POST", body: {} },
        true,
      );
    },

    async report(interestId, reason) {
      await rest("rpc/report_topic", {
        method: "POST",
        body: { p_interest: interestId, p_reason: reason.trim() },
      });
    },

    async picks() {
      const rows = await rest<
        (Omit<TopicCardRow, "briefs" | "followers"> & {
          reason: string | null;
        })[]
      >("rpc/my_picks", { method: "POST", body: {} });
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        tags: r.tags ?? [],
        ownerName: r.owner_name,
        team: r.team,
        reason: r.reason ?? "",
      }));
    },

    async dismissPick(interestId) {
      await rest("rpc/dismiss_pick", {
        method: "POST",
        body: { p_interest: interestId },
      });
    },

    async profile() {
      const s = await session();
      const rows = await rest<ProfileRow[]>(
        `profiles?id=eq.${encodeURIComponent(s.userId)}&select=display_name,location,student,role,liked_tags`,
      );
      const r = rows[0];
      return {
        displayName: r?.display_name ?? null,
        location: r?.location ?? null,
        student: r?.student ?? null,
        role: r?.role ?? null,
        likedTags: r?.liked_tags ?? [],
      };
    },

    async setProfile(change) {
      const s = await session();
      const row: Record<string, unknown> = {};
      const text = (v: string | null) => (v?.trim() ? v.trim() : null);
      if ("displayName" in change)
        row.display_name = text(change.displayName ?? null);
      if ("location" in change) row.location = text(change.location ?? null);
      if ("role" in change) row.role = text(change.role ?? null);
      if ("student" in change) row.student = change.student ?? null;
      if ("likedTags" in change) row.liked_tags = change.likedTags ?? [];
      if (Object.keys(row).length === 0) return;
      try {
        await rest(`profiles?id=eq.${encodeURIComponent(s.userId)}`, {
          method: "PATCH",
          body: row,
          prefer: "return=minimal",
        });
      } catch (err) {
        if (err instanceof HostedError && err.kind === "failed")
          throw new HostedError(
            "failed",
            "Couldn't save that. Check the name isn't Scout's or an admin's, and try again.",
          );
        throw err;
      }
    },

    async marks(kind) {
      const rows = await rest<MarkRow[]>(
        `story_marks?kind=eq.${kind}&select=story_key,interest_id,story,created_at&order=created_at.desc`,
      );
      return rows.map((r) => ({
        storyKey: r.story_key,
        interestId: r.interest_id,
        story: r.story,
        createdAt: r.created_at,
      }));
    },

    async mark(kind, mark) {
      await rest("story_marks?on_conflict=user_id,kind,story_key", {
        method: "POST",
        body: {
          kind,
          story_key: mark.storyKey,
          interest_id: mark.interestId,
          story: mark.story,
        },
        prefer: "return=minimal,resolution=ignore-duplicates",
      });
    },

    async unmark(kind, storyKey) {
      await rest(
        `story_marks?kind=eq.${kind}&story_key=eq.${encodeURIComponent(storyKey)}`,
        { method: "DELETE", prefer: "return=minimal" },
      );
    },

    async sendEvents(events) {
      for (let at = 0; at < events.length; at += MAX_EVENT_BATCH) {
        await rest("usage_events", {
          method: "POST",
          body: events.slice(at, at + MAX_EVENT_BATCH).map((e) => ({
            kind: e.kind,
            interest_id: e.interestId,
            run_id: e.runId ?? null,
            story_key: "storyKey" in e ? e.storyKey : null,
            seconds:
              e.kind === "story_seconds"
                ? Math.min(3600, Math.max(0, Math.round(e.seconds)))
                : null,
          })),
          prefer: "return=minimal",
          keepalive: true,
        });
      }
    },
  };
}

type TopicCardRow = {
  id: string;
  slug: string;
  title: string;
  tags: string[] | null;
  owner_name: string | null;
  team: boolean;
  followers?: number;
  briefs: TopicCard["briefs"] | null;
};

type ProfileRow = {
  display_name: string | null;
  location: string | null;
  student: boolean | null;
  role: string | null;
  liked_tags: string[] | null;
};

type MarkRow = {
  story_key: string;
  interest_id: string | null;
  story: Record<string, unknown> | null;
  created_at: string;
};

const INTEREST_COLUMNS = `id,topic,cadence,visibility,share_slug,tags,${BRIEF_SETTINGS_COLUMNS}`;

type InterestRow = Partial<BriefSettingsRow> & {
  id: string;
  topic: string;
  cadence: Cadence;
  visibility: Visibility;
  share_slug: string | null;
  tags?: string[] | null;
};

type NoticeRow = {
  id: string;
  kind: NoticeKind;
  payload: { topic?: string; reason?: string | null } | null;
  created_at: string;
};

type SharedRow = {
  id: string;
  topic: string;
  visibility: Visibility;
  owned: boolean;
  following: boolean;
  run: {
    id: string;
    section_md: string | null;
    coverage: TopicCoverage | null;
    finished_at: string | null;
  } | null;
};

type RunRow = {
  id: string;
  interest_id: string;
  status: "queued" | "running" | "ready" | "failed";
  section_md: string | null;
  coverage: TopicCoverage | null;
  error_msg: string | null;
  created_at: string;
  finished_at: string | null;
};

type AllowanceRow = {
  plan: string;
  used: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_today: number;
  };
  limits: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_per_day: number;
  };
};

// Runs come newest first. Per interest: the run in flight, the newest ready
// section, and a failure only when it is newer than that section.
function assembleHome(
  rows: (InterestRow & { following: boolean })[],
  runs: RunRow[],
  a: AllowanceRow,
): Omit<HostedHome, "isAdmin" | "notices"> {
  const sections: { topic: string; section: string }[] = [];
  const coverage: TopicCoverage[] = [];
  let newest: RunRow | null = null;

  const interests = rows.map((row): HostedInterest => {
    const mine = runs.filter((r) => r.interest_id === row.id);
    const active = mine.find(
      (r) => r.status === "queued" || r.status === "running",
    );
    const ready = mine.find((r) => r.status === "ready" && r.section_md);
    const lastDone = mine.find(
      (r) => r.status === "ready" || r.status === "failed",
    );
    if (ready?.section_md) {
      sections.push({ topic: row.topic, section: ready.section_md });
      if (ready.coverage) coverage.push(ready.coverage);
      if (!newest || doneAt(ready) > doneAt(newest)) newest = ready;
    }
    return {
      id: row.id,
      topic: row.topic,
      cadence: row.cadence,
      settings: briefSettingsFromRow(row),
      following: row.following,
      visibility: row.visibility,
      shareSlug: row.share_slug,
      tags: row.tags ?? [],
      run: active ? (active.status as "queued" | "running") : null,
      updatedAt: ready ? doneAt(ready) : null,
      failed:
        lastDone?.status === "failed"
          ? "The last run failed. Run it again, or wait for the next one."
          : null,
      ownerName: null,
      team: false,
    };
  });

  const latest = newest as RunRow | null;
  return {
    interests,
    brief: latest
      ? briefFrom(sections, coverage, { id: latest.id, at: doneAt(latest) })
      : null,
    allowance: {
      plan: a.plan,
      daily: { used: a.used.daily_interests, limit: a.limits.daily_interests },
      weekly: {
        used: a.used.weekly_interests,
        limit: a.limits.weekly_interests,
      },
      runsToday: {
        used: a.used.on_demand_runs_today,
        limit: a.limits.on_demand_runs_per_day,
      },
    },
  };
}

// Brief sections as one Brief, named after the newest run in it.
function briefFrom(
  sections: { topic: string; section: string }[],
  coverage: TopicCoverage[],
  newest: { id: string; at: string },
): Brief {
  const markdown = assembleBrief(sections);
  const id = `hosted-${newest.id}`;
  const parsed = parseArticlesFromMarkdown(markdown, id);
  return {
    id,
    generatedAt: newest.at,
    interests: parsed.interests,
    articles: parsed.articles,
    markdown,
    topics: coverage,
  };
}

function doneAt(r: RunRow): string {
  return r.finished_at ?? r.created_at;
}

// PostgREST's error body: the quota trigger raises P0001 with the limit's name
// as the hint (core's quotaMessage words it); the sharing calls raise P0002 for
// a link or notice that is gone.
function restError(body: unknown): HostedError {
  const err = (body ?? {}) as {
    code?: string;
    hint?: string;
    message?: string;
  };
  const limit = quotaMessage(err);
  if (limit) return new HostedError("limit", limit);
  if (err.code === "P0002")
    return new HostedError(
      "failed",
      "That's no longer shared. Ask whoever sent it for a new link.",
    );
  return new HostedError("failed", "Couldn't save that. Try again.");
}

function workerLimitMessage(path: string, said: string): string {
  if (path === "/runs") {
    const limit = /of (\d+)/.exec(said)?.[1];
    return `You've used today's ${plural(limit, "run")}. Scheduled briefs still come.`;
  }
  // The chat's refusals are already written for the reader (chat_block_reason).
  return said || "Scout has paused new work for now. Try again later.";
}

/** The signed-in reader's likes in the database, for likes.ts. */
export function likesSync(data: HostedData): LikesSync {
  return marksSync(data, "like");
}

/** The signed-in reader's likes or saves in the database, for the story
 *  marks stores. The story snapshot is trimmed to fit story_marks' 4 KB. */
export function marksSync(data: HostedData, kind: MarkKind): LikesSync {
  return {
    async list() {
      const marks = await data.marks(kind);
      return marks.flatMap((m) =>
        m.story ? [{ ...m.story, key: m.storyKey } as LikedStory] : [],
      );
    },
    async add(story) {
      const snapshot = {
        ...story,
        headline: story.headline.slice(0, 300),
        blurb: story.blurb?.slice(0, 600),
        url: story.url.slice(0, 1000),
        imageUrl:
          story.imageUrl && story.imageUrl.length <= 600
            ? story.imageUrl
            : undefined,
      };
      await data.mark(kind, {
        storyKey: story.key,
        interestId: null,
        story: snapshot,
      });
    },
    async remove(key) {
      await data.unmark(kind, key);
    },
  };
}

/** What the reader's plan has left, in one plain line. */
export function allowanceLine(a: Allowance): string {
  const left = (x: { used: number; limit: number }) =>
    Math.max(0, x.limit - x.used);
  const plan = a.plan.charAt(0).toUpperCase() + a.plan.slice(1);
  return (
    `${plan} plan: ${left(a.daily)} of ${a.daily.limit} daily and ` +
    `${left(a.weekly)} of ${a.weekly.limit} weekly slots free. ` +
    `${plural(left(a.runsToday), "run")} left today.`
  );
}

/** The page a share link opens: `/i/?s=<slug>`, under the app's base path. */
export function shareUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${base}/i/?s=${encodeURIComponent(slug)}`;
}

/** This browser's push side. The service worker (public/sw.js) shows the
 *  pushes; it is registered only when the reader turns notifications on. */
export function browserPushDevice(base: string): PushDevice | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = `${base}/`;
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const installed =
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  const keysOf = (sub: PushSubscription | null): PushKeys | null => {
    const json = sub?.toJSON();
    return json?.endpoint && json.keys?.p256dh && json.keys.auth
      ? {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        }
      : null;
  };
  const current = async () =>
    (await navigator.serviceWorker.getRegistration(scope)) ?? null;
  return {
    supported:
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    needsInstall: ios && !installed,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async subscription() {
      const reg = await current();
      return reg ? keysOf(await reg.pushManager.getSubscription()) : null;
    },
    async subscribe(key) {
      await navigator.serviceWorker.register(`${base}/sw.js`, { scope });
      const reg = await navigator.serviceWorker.ready;
      const keys = keysOf(
        await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64urlBytes(key),
        }),
      );
      if (!keys) throw new Error("subscription without keys");
      return keys;
    },
    async unsubscribe() {
      const sub = await (await current())?.pushManager.getSubscription();
      if (!sub) return null;
      await sub.unsubscribe();
      return sub.endpoint;
    },
  };
}

function base64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let hosted: HostedData | null | undefined;

/** The app's one HostedData, or null in a build without hosted config. */
export function hostedData(): HostedData | null {
  if (hosted !== undefined) return hosted;
  const config = hostedConfig();
  const auth = hostedAuth();
  if (!config || !auth) return (hosted = null);
  // The literal NODE_ENV test lets a production build drop the fake entirely.
  if (process.env.NODE_ENV !== "production" && fakeHostedOn())
    return (hosted = createFakeHostedData());
  hosted = createHostedData({
    supabaseUrl: config.url,
    anonKey: config.anonKey,
    workerUrl: (process.env.NEXT_PUBLIC_SCOUT_WORKER_URL ?? "").replace(
      /\/$/,
      "",
    ),
    session: async () => {
      const user = await auth.currentUser();
      const token = user ? await auth.accessToken() : null;
      return user && token ? { userId: user.id, accessToken: token } : null;
    },
    push: browserPushDevice(process.env.NEXT_PUBLIC_BASE_PATH ?? ""),
    vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  });
  return hosted;
}

let likesFollowed = false;

/** Ties the likes and saves stores to the hosted session for this page load: the signed-in
 *  reader's likes come from the database, and sign-out or an account switch
 *  drops the previous reader's. Safe to call more than once. */
export function startHostedLikes(): void {
  if (likesFollowed) return;
  const auth = hostedAuth();
  const data = hostedData();
  if (!auth || !data) return;
  likesFollowed = true;
  followLikes(auth, likesSync(data));
  followSaves(auth, marksSync(data, "save"));
}
