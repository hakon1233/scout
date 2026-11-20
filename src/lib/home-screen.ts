"use client";

// "Add Scout to your Home Screen": a feed card shown at most once a week, on
// phones only, until Scout runs installed. Showing it records the time.

import { getLocalStorage, safeSetItem } from "./safe-storage";

const KEY = "scout.homeScreenCard.v1";
export const HOME_SCREEN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type HomeScreenDevice = {
  phone: boolean;
  installed: boolean;
  iphone: boolean;
};

/** Pure rule: phone, not installed, never shown or shown a week or more ago. */
export function shouldShowHomeScreenCard(input: {
  device: HomeScreenDevice;
  lastShownAt: number | null;
  now: number;
}): boolean {
  const { device, lastShownAt, now } = input;
  if (!device.phone || device.installed) return false;
  if (lastShownAt === null) return true;
  return now - lastShownAt >= HOME_SCREEN_INTERVAL_MS;
}

export function readLastShown(): number | null {
  const raw = getLocalStorage()?.getItem(KEY) ?? null;
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function markShown(now: number): void {
  safeSetItem(KEY, String(now));
}

/** This browser, read once on the client. */
export function homeScreenDevice(): HomeScreenDevice {
  if (typeof window === "undefined")
    return { phone: false, installed: false, iphone: false };
  const media = (q: string) => window.matchMedia?.(q).matches ?? false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const iphone = /iPhone|iPod/.test(nav.userAgent);
  return {
    phone:
      iphone || (media("(pointer: coarse)") && media("(max-width: 767px)")),
    installed: media("(display-mode: standalone)") || nav.standalone === true,
    iphone,
  };
}

let turn: HomeScreenDevice | null | undefined;

/** Decide once per page load and record the showing, so the next one waits a
 *  week. Remounts in the same load get the same answer. */
export function takeHomeScreenTurn(now = Date.now()): HomeScreenDevice | null {
  if (turn !== undefined) return turn;
  const device = homeScreenDevice();
  turn = shouldShowHomeScreenCard({ device, lastShownAt: readLastShown(), now })
    ? device
    : null;
  if (turn) markShown(now);
  return turn;
}
