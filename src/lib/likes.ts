"use client";

import * as React from "react";

import { getLocalStorage, isClient, safeSetItem } from "./safe-storage";

// PER-249: device-local "liked stories" store. A brand-new localStorage store,
// fully separate from the interests store and from every companion endpoint.
//
// HARD SAFETY (PER-249): this feature makes NO network calls at all — so it
// physically cannot reach the destructive replace-all `POST /v0/interests`.
// Likes are pure client state for v1; the constraint is satisfied by
// construction, not by discipline. No account/sync in v1.
//
// WHY WE KEY ON CANONICAL URL, NOT THE ARTICLE ID: article ids are generated as
// `${briefId}-${idx}` (companion.ts) — brief-scoped, so the SAME story gets a
// different id in tomorrow's edition. The canonical URL is the only identity a
// story carries across briefs, so keying on it is what makes a like "survive a
// new brief". FeedView dedupes on this same canonicalisation, so likes and
// dedupe agree.
//
// WHY WE SNAPSHOT THE STORY: we keep only the last + previous brief locally
// (storage.ts), so a liked story routinely ages out of every cached brief. The
// Liked feed must still render it, so a like stores a display snapshot captured
// at like-time rather than a pointer into a brief.

const LIKES_KEY = "scout.likes.v1";

export type LikedStory = {
  // canonicalUrl(url) — the stable cross-brief identity and the store map key.
  key: string;
  // The original (un-canonicalised) url, used for the "read at source" link.
  url: string;
  headline: string;
  blurb?: string;
  source: string;
  // = article.interest. Retained so likes can later feed a relevance signal
  // (future hook only — no behavior built on it now).
  topic: string;
  imageUrl?: string;
  publishedAt?: string;
  // ISO timestamp; drives newest-liked-first ordering in the Liked feed.
  likedAt: string;
};

// The fields a caller supplies to like a story (everything except the derived
// `key` and the `likedAt` stamp we add).
export type LikeInput = Omit<LikedStory, "key" | "likedAt">;

type LikesStore = { version: 1; likes: Record<string, LikedStory> };

// Stable empty reference for SSR / pre-hydration and for parse failures, so
// useSyncExternalStore sees a referentially-stable snapshot.
const EMPTY: LikesStore = { version: 1, likes: {} };

// Strip hash, query, and a trailing slash so cosmetic URL variants of the same
// story collapse to one key. Mirrors FeedView's historical dedupe behaviour
// (which now imports this very function).
export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return u;
  }
}

export function likeKey(url: string): string {
  return canonicalUrl(url);
}

// --- store internals -------------------------------------------------------

// Cache the parsed store keyed by the raw string, so getSnapshot() returns a
// referentially-stable object until localStorage actually changes (required by
// useSyncExternalStore to avoid render loops).
let cache: LikesStore = EMPTY;
let cacheRaw: string | null = null;

const listeners = new Set<() => void>();
let storageListenerInstalled = false;

function parse(raw: string | null): LikesStore {
  if (!raw) return EMPTY;
  try {
    const obj = JSON.parse(raw) as Partial<LikesStore>;
    // `typeof null === "object"`, so a stored `{ "likes": null }` would slip
    // past a bare typeof check and later crash `Object.values(store.likes)` /
    // `key in store.likes`. Reject null explicitly so a corrupted value
    // degrades to EMPTY instead of throwing during render.
    if (
      !obj ||
      typeof obj !== "object" ||
      !obj.likes ||
      typeof obj.likes !== "object"
    ) {
      return EMPTY;
    }
    return { version: 1, likes: obj.likes as Record<string, LikedStory> };
  } catch {
    return EMPTY;
  }
}

function read(): LikesStore {
  const raw = getLocalStorage()?.getItem(LIKES_KEY) ?? null;
  if (!isClient()) return EMPTY;
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  cache = parse(raw);
  return cache;
}

function write(next: LikesStore): void {
  if (!isClient()) return;
  const raw = JSON.stringify(next);
  cacheRaw = raw;
  cache = next;
  // Quota / private-mode failures are swallowed by safeSetItem: the in-memory
  // cache above still reflects the toggle for this session so the UI stays
  // responsive; it just won't persist.
  safeSetItem(LIKES_KEY, raw);
  notify();
}

function notify(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!storageListenerInstalled && isClient()) {
    storageListenerInstalled = true;
    // Cross-tab consistency: another tab wrote likes → drop our cache so the
    // next read() re-parses, then re-render subscribers.
    window.addEventListener("storage", (e) => {
      if (e.key === LIKES_KEY) {
        cacheRaw = null;
        notify();
      }
    });
  }
  return () => {
    listeners.delete(fn);
  };
}

// --- public API ------------------------------------------------------------

export function isLiked(key: string): boolean {
  return key in read().likes;
}

// Toggle a story's liked state. Synchronous + optimistic: it writes localStorage
// and notifies subscribers before returning, so every on-screen heart flips at
// once. Returns the new liked state.
export function toggleLike(input: LikeInput): boolean {
  const key = likeKey(input.url);
  const store = read();
  const likes = { ...store.likes };
  let liked: boolean;
  if (key in likes) {
    delete likes[key];
    liked = false;
  } else {
    likes[key] = { ...input, key, likedAt: new Date().toISOString() };
    liked = true;
  }
  write({ version: 1, likes });
  return liked;
}

export function removeLike(key: string): void {
  const store = read();
  if (!(key in store.likes)) return;
  const likes = { ...store.likes };
  delete likes[key];
  write({ version: 1, likes });
}

// --- React hooks -----------------------------------------------------------

function useStore(): LikesStore {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useIsLiked(key: string): boolean {
  // Primitive snapshot → referentially stable by value, no extra memo needed.
  return React.useSyncExternalStore(
    subscribe,
    () => key in read().likes,
    () => false,
  );
}

export function useLikedStories(): LikedStory[] {
  const store = useStore();
  return React.useMemo(
    () =>
      // likedAt is ISO-8601, so lexicographic order == chronological order.
      // Plain string compare avoids the per-comparison Intl cost of localeCompare
      // on every like toggle (this re-sorts the whole collection each change).
      Object.values(store.likes).sort((a, b) =>
        a.likedAt < b.likedAt ? 1 : a.likedAt > b.likedAt ? -1 : 0,
      ),
    [store],
  );
}
