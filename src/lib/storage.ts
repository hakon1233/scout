"use client";

import type { Brief, Settings } from "./types";

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";
const LEGACY_SETTINGS_KEY = "notiva.settings.v1";
const LEGACY_BRIEF_KEY = "notiva.lastBrief.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readWithMigration(key: string, legacyKey: string): string | null {
  const current = window.localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = window.localStorage.getItem(legacyKey);
  if (legacy !== null) {
    window.localStorage.setItem(key, legacy);
    window.localStorage.removeItem(legacyKey);
    return legacy;
  }
  return null;
}

export function loadSettings(): Settings | null {
  if (typeof window === "undefined") return null;
  return safeParse<Settings>(
    readWithMigration(SETTINGS_KEY, LEGACY_SETTINGS_KEY),
  );
}

export function saveSettings(s: Settings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadLastBrief(): Brief | null {
  if (typeof window === "undefined") return null;
  return safeParse<Brief>(readWithMigration(BRIEF_KEY, LEGACY_BRIEF_KEY));
}

export function saveLastBrief(b: Brief): void {
  window.localStorage.setItem(BRIEF_KEY, JSON.stringify(b));
}

export function clearLastBrief(): void {
  window.localStorage.removeItem(BRIEF_KEY);
}

export function clearSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SETTINGS_KEY);
  window.localStorage.removeItem(BRIEF_KEY);
}
