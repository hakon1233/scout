"use client";

import type { Brief, Settings } from "./types";
import { getLocalStorage, safeSetItem } from "./safe-storage";

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";
// Legacy one-deep brief archive key (PER-146). The client-side prevBrief
// rotation was removed (PER-219); no code reads or writes this anymore. Retained
// only so clearSettings() purges any value left over in older installs.
const PREV_BRIEF_KEY = "scout.prevBrief.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isSettings(raw: unknown): raw is Settings {
  if (!raw || typeof raw !== "object") return false;
  const candidate = raw as Partial<Settings>;
  return (
    typeof candidate.name === "string" &&
    Array.isArray(candidate.interests) &&
    candidate.interests.every(
      (interest) =>
        interest &&
        typeof interest === "object" &&
        typeof interest.id === "string" &&
        typeof interest.topic === "string",
    )
  );
}

// Persist one key via the shared write guard (safe-storage.ts). The guard
// matters most here because `saveLastBrief` runs inside a `setBrief` updater
// (app/page.tsx): an unguarded throw would abort the caller *before* its
// in-memory setState, so the UI would neither persist nor update. Degrading
// keeps the React state authoritative for the session.
const safeSet = safeSetItem;

export function loadSettings(): Settings | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  const raw = safeParse<Settings & { anthropicKey?: string; exaKey?: string }>(
    storage.getItem(SETTINGS_KEY),
  );
  if (!isSettings(raw)) return null;
  // Migration (PER-133): the BYO-key path was removed (PER-109), so old stored
  // settings may still carry `anthropicKey`/`exaKey`. Drop them on read so the
  // in-memory shape matches the current `Settings` type. The next save persists
  // the slimmed object. No-op for users who never stored keys.
  return { name: raw.name, interests: raw.interests ?? [] };
}

export function saveSettings(s: Settings): void {
  safeSet(SETTINGS_KEY, JSON.stringify(s));
}

export function loadLastBrief(): Brief | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  return safeParse<Brief>(storage.getItem(BRIEF_KEY));
}

export function saveLastBrief(b: Brief): void {
  safeSet(BRIEF_KEY, JSON.stringify(b));
}

export function clearLastBrief(): void {
  getLocalStorage()?.removeItem(BRIEF_KEY);
}

export function clearSettings(): void {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.removeItem(SETTINGS_KEY);
  storage.removeItem(BRIEF_KEY);
  storage.removeItem(PREV_BRIEF_KEY);
}
