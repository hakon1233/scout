"use client";

import * as React from "react";

import { getLocalStorage, isClient, safeSetItem } from "./safe-storage";
import { canonicalUrl } from "@scout/core";

// "Liked stories": a localStorage store, fully separate from the interests
// store and from every companion endpoint. It never calls the companion, so it
// cannot reach the destructive replace-all `POST /v0/interests`.
//
// SIGNED IN (hosted): `setLikesUser(userId, sync)` keys the store by the
// reader's id and loads their likes from the database (story_marks); each
// toggle is then also sent through `sync`. Signed out, likes stay on the
// device under the plain key and are never uploaded: signing in does not move
// them into an account, so on a shared device one reader's likes cannot land
// in another's. Signing out drops the signed-in reader's local copy.
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

/** Where a signed-in reader's likes live (hosted: story_marks). */
export type LikesSync = {
  list(): Promise<LikedStory[]>;
  add(story: LikedStory): Promise<void>;
  remove(key: string): Promise<void>;
};

let user: { id: string; sync: LikesSync | null } | null = null;

function storeKey(): string {
  return user ? `${LIKES_KEY}:${user.id}` : LIKES_KEY;
}

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

function isLikedStory(raw: unknown): raw is LikedStory {
  if (!raw || typeof raw !== "object") return false;
  const story = raw as Partial<LikedStory>;
  return (
    typeof story.key === "string" &&
    typeof story.url === "string" &&
    typeof story.headline === "string" &&
    typeof story.source === "string" &&
    typeof story.topic === "string" &&
    typeof story.likedAt === "string" &&
    (story.blurb === undefined || typeof story.blurb === "string") &&
    (story.imageUrl === undefined || typeof story.imageUrl === "string") &&
    (story.publishedAt === undefined || typeof story.publishedAt === "string")
  );
}

function parse(raw: string | null): LikesStore {
  if (!raw) return EMPTY;
  try {
    const obj = JSON.parse(raw) as Partial<LikesStore>;
    // `typeof null === "object"`, so both a stored `{ "likes": null }` and
    // object-shaped stores with null/malformed entries must be rejected before
    // render paths call `Object.values(store.likes)` or `key in store.likes`.
    if (
      !obj ||
      typeof obj !== "object" ||
      !obj.likes ||
      typeof obj.likes !== "object"
    ) {
      return EMPTY;
    }
    const likes: Record<string, LikedStory> = {};
    for (const [key, story] of Object.entries(obj.likes)) {
      if (isLikedStory(story)) likes[key] = story;
    }
    return Object.keys(likes).length > 0 ? { version: 1, likes } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function read(): LikesStore {
  const raw = getLocalStorage()?.getItem(storeKey()) ?? null;
  if (!isClient()) return EMPTY;
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  cache = parse(raw);
  return cache;
}

function write(next: LikesStore): void {
  if (!isClient()) return;
  const raw = JSON.stringify(next);
  cache = next;
  // Quota / private-mode failures are swallowed by safeSetItem: the in-memory
  // cache above still reflects the toggle for this session so the UI stays
  // responsive; it just won't persist.
  safeSetItem(storeKey(), raw);
  // Point cacheRaw at what localStorage ACTUALLY holds now, not at what we tried
  // to write. On a successful persist that's `raw`; on a swallowed persist it's
  // the pre-toggle value. Either way read()'s `raw === cacheRaw` guard now keeps
  // the optimistic `cache` above instead of re-parsing storage and silently
  // reverting the toggle for the session (Safari private mode / quota exceeded).
  cacheRaw = getLocalStorage()?.getItem(storeKey()) ?? null;
  notify();
}

/**
 * Who is reading: their id and where their likes live, or null when signed
 * out. Call it on every sign-in and sign-out (followLikes does). Switching
 * readers never carries likes across; signing out drops the last reader's
 * local copy. Resolves once the reader's likes are loaded.
 */
export async function setLikesUser(
  userId: string | null,
  sync: LikesSync | null = null,
): Promise<void> {
  const previous = user;
  if ((previous?.id ?? null) === userId && (previous?.sync ?? null) === sync)
    return;
  if (previous && previous.id !== userId) {
    try {
      getLocalStorage()?.removeItem(`${LIKES_KEY}:${previous.id}`);
    } catch {
      // Storage unavailable: nothing to drop.
    }
  }
  user = userId ? { id: userId, sync } : null;
  cacheRaw = null;
  cache = EMPTY;
  notify();
  const mine = user;
  if (!mine?.sync) return;
  let stories: LikedStory[];
  try {
    stories = await mine.sync.list();
  } catch (err) {
    console.warn("[likes] could not load likes:", err);
    return;
  }
  if (user !== mine) return; // signed out or switched meanwhile
  const likes: Record<string, LikedStory> = {};
  for (const s of stories) if (isLikedStory(s)) likes[s.key] = s;
  write({ version: 1, likes });
}

/**
 * Keeps the likes store on whoever `auth` says is signed in: each sign-in,
 * account switch and sign-out calls setLikesUser with that reader and `sync`.
 * Supabase reports the current session to a new listener, so this also covers
 * the session found at page load. Returns unsubscribe.
 */
export function followLikes(
  auth: {
    onAuthChange(listener: (user: { id: string } | null) => void): () => void;
  },
  sync: LikesSync,
): () => void {
  return auth.onAuthChange((reader) => {
    void setLikesUser(reader?.id ?? null, reader ? sync : null);
  });
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
      if (e.key === storeKey()) {
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
  // Signed in: the database too. A failed send keeps the local toggle for
  // this session; the next sign-in reloads from the database.
  const sync = user?.sync;
  if (sync) {
    const sent = liked ? sync.add(likes[key]) : sync.remove(key);
    sent.catch((err: unknown) => console.warn("[likes] not saved:", err));
  }
  return liked;
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
