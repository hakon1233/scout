import { canonicalUrl } from "@scout/core";
import { MAX_EVENT_BATCH, type HostedData, type UsageEvent } from "./hosted";

// What the hosted app records about reading, for picks and the offer to mute
// a topic the reader skips (named on the privacy page): which stories they
// open, how long each stays open, and which topics' briefs they see. Events
// queue in memory and go out in one batch when the page is hidden or closed
// (visibilitychange, pagehide), or as soon as a batch is full.
//
// Nothing is recorded until startUsage runs, and only the hosted pages call
// it for a signed-in reader, so the companion app never sends anything.

type Topic = { id: string; topic: string };

export type UsageTracker = {
  /** The reader's topics, to turn a story's topic name into its interest. */
  setTopics(topics: readonly Topic[]): void;
  /** A brief was shown: one brief_view per topic in it, once per brief. */
  briefViewed(briefId: string, topicNames: readonly string[]): void;
  /** A story was opened: a story_click, and its reading time starts. */
  storyOpened(topic: string, url: string): void;
  /** The open story was closed: its reading time as story_seconds. */
  storyClosed(): void;
  /** The page went out of sight: the open story's time so far, then send. */
  hidden(): void;
  /** Back in sight: the open story's time runs again. */
  visible(): void;
  /** Sends what is queued. */
  flush(): void;
};

const key = (t: string) => t.trim().toLowerCase();

export function createUsageTracker(deps: {
  send: (events: UsageEvent[]) => Promise<void>;
  now?: () => number;
  max?: number;
}): UsageTracker {
  const now = deps.now ?? (() => Date.now());
  const max = deps.max ?? MAX_EVENT_BATCH;
  const queue: UsageEvent[] = [];
  const viewed = new Set<string>();
  let topics = new Map<string, string>();
  let open: {
    interestId: string;
    storyKey: string;
    since: number | null;
    ms: number;
  } | null = null;

  function add(event: UsageEvent) {
    queue.push(event);
    if (queue.length >= max) flush();
  }

  function flush() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    deps.send(batch).catch(() => {
      // Usage is best effort: a lost batch is not worth bothering the reader.
    });
  }

  // Adds the open story's running time and stops its clock.
  function pause() {
    if (open?.since != null) {
      open.ms += now() - open.since;
      open.since = null;
    }
  }

  function recordSeconds() {
    if (!open) return;
    pause();
    const seconds = Math.round(open.ms / 1000);
    if (seconds >= 1)
      add({
        kind: "story_seconds",
        interestId: open.interestId,
        storyKey: open.storyKey,
        seconds,
      });
    open.ms = 0;
  }

  return {
    setTopics(list) {
      topics = new Map(list.map((t) => [key(t.topic), t.id]));
    },
    briefViewed(briefId, topicNames) {
      for (const name of new Set(topicNames.map(key))) {
        const interestId = topics.get(name);
        const seen = `${briefId}:${interestId}`;
        if (!interestId || viewed.has(seen)) continue;
        viewed.add(seen);
        add({ kind: "brief_view", interestId });
      }
    },
    storyOpened(topic, url) {
      if (open) this.storyClosed();
      const interestId = topics.get(key(topic));
      if (!interestId) return;
      const storyKey = canonicalUrl(url);
      add({ kind: "story_click", interestId, storyKey });
      open = { interestId, storyKey, since: now(), ms: 0 };
    },
    storyClosed() {
      recordSeconds();
      open = null;
    },
    hidden() {
      recordSeconds();
      flush();
    },
    visible() {
      if (open && open.since == null) open.since = now();
    },
    flush,
  };
}

// --- the page's one tracker --------------------------------------------------

let active: UsageTracker | null = null;
// Briefs shown before startUsage ran (a child's effect runs before its
// parent's), kept in memory and recorded once it starts. Never sent without it.
let early: [string, readonly string[]][] = [];

/**
 * Starts recording for a signed-in hosted reader (call again to update the
 * topics). Until then every `usage` call does nothing.
 */
export function startUsage(
  data: Pick<HostedData, "sendEvents">,
  topics: readonly Topic[],
): void {
  if (!active) {
    const tracker = createUsageTracker({ send: (e) => data.sendEvents(e) });
    active = tracker;
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", () =>
        document.visibilityState === "hidden"
          ? tracker.hidden()
          : tracker.visible(),
      );
      window.addEventListener("pagehide", () => tracker.hidden());
    }
  }
  active.setTopics(topics);
  for (const [briefId, names] of early.splice(0))
    active.briefViewed(briefId, names);
}

/** For tests: forget the page's tracker. */
export function stopUsage(): void {
  active = null;
  early = [];
}

/** The page's tracker; a no-op until startUsage. */
export const usage: Pick<
  UsageTracker,
  "briefViewed" | "storyOpened" | "storyClosed"
> = {
  briefViewed: (briefId, topicNames) => {
    if (active) active.briefViewed(briefId, topicNames);
    else if (early.length < 10) early.push([briefId, topicNames]);
  },
  storyOpened: (topic, url) => active?.storyOpened(topic, url),
  storyClosed: () => active?.storyClosed(),
};
