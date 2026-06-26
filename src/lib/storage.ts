"use client";

import type { Brief, Settings } from "./types";

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";
// One-deep recoverable archive of the brief that a user-initiated regenerate
// replaces (PER-146). Holds exactly the *previous* edition; latest lives in
// BRIEF_KEY. A third regenerate drops the oldest — honest one-deep history.
const PREV_BRIEF_KEY = "scout.prevBrief.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Mirror of likes.ts `write()`: localStorage.setItem throws on quota-exceeded
// and in private-mode browsers. An unguarded throw here aborts the caller
// *before* its in-memory setState, so the UI would neither persist nor update.
// Swallow the failure — the caller's React state still reflects the change for
// this session; it just won't survive a reload.
function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota / private-mode: best-effort persistence only.
  }
}

export function loadSettings(): Settings | null {
  if (typeof window === "undefined") return null;
  const raw = safeParse<Settings & { anthropicKey?: string; exaKey?: string }>(
    window.localStorage.getItem(SETTINGS_KEY),
  );
  if (!raw) return null;
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
  if (typeof window === "undefined") return null;
  return safeParse<Brief>(window.localStorage.getItem(BRIEF_KEY));
}

export function saveLastBrief(b: Brief): void {
  safeSet(BRIEF_KEY, JSON.stringify(b));
}

export function clearLastBrief(): void {
  window.localStorage.removeItem(BRIEF_KEY);
}

export function loadPrevBrief(): Brief | null {
  if (typeof window === "undefined") return null;
  return safeParse<Brief>(window.localStorage.getItem(PREV_BRIEF_KEY));
}

export function savePrevBrief(b: Brief): void {
  safeSet(PREV_BRIEF_KEY, JSON.stringify(b));
}

export function clearPrevBrief(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREV_BRIEF_KEY);
}

export function clearSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SETTINGS_KEY);
  window.localStorage.removeItem(BRIEF_KEY);
  window.localStorage.removeItem(PREV_BRIEF_KEY);
}
