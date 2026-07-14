import assert from "node:assert/strict";
import test from "node:test";

import { isLiked, likeKey, toggleLike } from "./likes";

// Regression tests for the device-local likes store's write/read cache coherence
// (AIR-612 bug-hunt). The store keeps a raw-string cache so useSyncExternalStore
// sees a referentially-stable snapshot; the invariant is that a swallowed persist
// (Safari private mode / QuotaExceededError) must NOT undo the optimistic like —
// safe-storage.ts promises "the in-memory cache still reflects the toggle for
// this session; it just won't survive a reload."

const LIKES_KEY = "scout.likes.v1";

type StorageStub = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// Install a stub window.localStorage backed by an in-memory Map. When
// `failWrites` is set, setItem throws (like a full/private-mode store) and never
// mutates the backing map — exactly the case where getItem keeps returning the
// pre-toggle value while the caller believes it wrote.
function installStorage(opts: { failWrites: boolean }): {
  backing: Map<string, string>;
  restore: () => void;
} {
  const previousWindow = globalThis.window;
  const backing = new Map<string, string>();
  const localStorage: StorageStub = {
    getItem(key) {
      return backing.has(key) ? (backing.get(key) as string) : null;
    },
    setItem(key, value) {
      if (opts.failWrites) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      backing.set(key, value);
    },
    removeItem(key) {
      backing.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, addEventListener() {} },
  });
  return {
    backing,
    restore() {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      } else {
        // @ts-expect-error Restoring the Node test environment.
        delete globalThis.window;
      }
    },
  };
}

test("a successful like persists and reads back as liked", () => {
  const { backing, restore } = installStorage({ failWrites: false });
  const url = "https://example.com/happy-path-story";
  try {
    assert.equal(
      toggleLike({ url, headline: "H", source: "example.com", topic: "AI" }),
      true,
    );
    assert.equal(isLiked(likeKey(url)), true);
    // Persisted for real: the backing store holds the like.
    const stored = backing.get(LIKES_KEY);
    assert.ok(stored && stored.includes(likeKey(url)));
  } finally {
    restore();
  }
});

test("a like whose persist is swallowed still reads as liked for the session", () => {
  const { backing, restore } = installStorage({ failWrites: true });
  const url = "https://example.com/quota-exceeded-story";
  try {
    // The toggle reports success and keeps an optimistic in-memory value...
    assert.equal(
      toggleLike({ url, headline: "H", source: "example.com", topic: "AI" }),
      true,
    );
    // ...so the very next read (the one useSyncExternalStore fires on notify)
    // must NOT revert it just because localStorage still returns the old value.
    assert.equal(isLiked(likeKey(url)), true);
    // The persist was correctly dropped (won't survive a reload) — that's fine.
    assert.equal(backing.has(LIKES_KEY), false);
  } finally {
    restore();
  }
});

test("toggling twice under a failing store un-likes within the session", () => {
  const { restore } = installStorage({ failWrites: true });
  const url = "https://example.com/toggle-twice-story";
  try {
    assert.equal(
      toggleLike({ url, headline: "H", source: "example.com", topic: "AI" }),
      true,
    );
    // Second toggle must see the optimistic liked state and remove it, not
    // re-like a story the session already believes is liked.
    assert.equal(
      toggleLike({ url, headline: "H", source: "example.com", topic: "AI" }),
      false,
    );
    assert.equal(isLiked(likeKey(url)), false);
  } finally {
    restore();
  }
});
