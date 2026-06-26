"use client";

// Single source of truth for the device-local-storage WRITE guard (AIR-326).
//
// localStorage writes throw *synchronously* in two situations every client
// store has to survive:
//   - QuotaExceededError — the store is full (briefs are the largest thing we
//     persist).
//   - SecurityError — storage is disabled or partitioned (Safari "private"
//     windows, some embedded webviews, enterprise lockdowns).
//
// Every persisted store wants the same degradation: keep the value in the
// in-memory React/cache state for this session and silently drop the persist,
// rather than letting the throw escape into a click handler, an async bootstrap,
// or a `setState` updater. Before this module that exact guard was hand-copied
// into FOUR places — `storage.ts:safeSet`, `likes.ts:write`,
// `companion.ts:saveCompanionToken` (added by FLI-333) and `ThemeToggle`'s bare
// catch — three of which carried comments explicitly telling the reader to keep
// them in sync with the others by hand. Routing every write through one
// primitive removes that drift risk.
export function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota / private-mode / disabled-storage write failure: keep the session
    // usable by dropping only the persist. The caller's in-memory state still
    // holds the value, so the only consequence is "won't survive a reload".
  }
}
