"use client";

// The notice cards at the top of the feed. Every kind Scout already knows (a
// topic hidden, stopped, unshared or deleted; a run failed; briefs stopped
// coming; lots of pushes) becomes one FeedNotice. The server's topic notices are dismissed on
// the server; the rest are dismissed on this device, by id, so a new failure
// shows again.

import type { NoticeKind } from "./hosted";
import { getLocalStorage, safeSetItem } from "./safe-storage";

export type FeedNotice = {
  id: string;
  kind: NoticeKind | "run_failed" | "run_stale" | "mute_pushes";
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

/** "Lots of pushes, mute some?" gets one id per week (from Monday, local
 *  time), so dismissing it hides it until the next week. */
export function muteNoticeId(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `mute_pushes:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
