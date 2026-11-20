"use client";

// The notice cards at the top of the feed. Every kind Scout already knows (a
// topic hidden, stopped, unshared or deleted; a run failed; briefs stopped
// coming) becomes one FeedNotice. The server's topic notices are dismissed on
// the server; the rest are dismissed on this device, by id, so a new failure
// shows again.

import type { NoticeKind } from "./hosted";
import { getLocalStorage, safeSetItem } from "./safe-storage";

export type FeedNotice = {
  id: string;
  kind: NoticeKind | "run_failed" | "run_stale";
  /** The topic it is about, when there is one. */
  topic: string | null;
  /** ISO time it happened, when known. */
  at: string | null;
};

const KEY = "scout.dismissedNotices.v1";
const KEEP = 50;

/** Notices without the dismissed ones, newest first as given. */
export function visibleNotices(
  all: FeedNotice[],
  dismissed: ReadonlySet<string>,
): FeedNotice[] {
  return all.filter((n) => !dismissed.has(n.id));
}

/** The first `max` to show, and how many sit behind "Show N more". */
export function splitNotices(
  list: FeedNotice[],
  max: number,
): { shown: FeedNotice[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** Ids dismissed on this device. A corrupt value reads as none. */
export function readDismissed(): Set<string> {
  try {
    const raw = getLocalStorage()?.getItem(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Remember a dismissal; keeps only the newest few ids. */
export function dismissLocally(id: string): Set<string> {
  const ids = [...readDismissed()].filter((x) => x !== id);
  ids.push(id);
  const kept = ids.slice(-KEEP);
  safeSetItem(KEY, JSON.stringify(kept));
  return new Set(kept);
}
