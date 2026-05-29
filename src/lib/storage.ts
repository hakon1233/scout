"use client";

import type { Brief, Settings } from "./types";

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings | null {
  if (typeof window === "undefined") return null;
  return safeParse<Settings>(window.localStorage.getItem(SETTINGS_KEY));
}

export function saveSettings(s: Settings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadLastBrief(): Brief | null {
  if (typeof window === "undefined") return null;
  return safeParse<Brief>(window.localStorage.getItem(BRIEF_KEY));
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
