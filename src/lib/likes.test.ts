import assert from "node:assert/strict";
import test from "node:test";

import {
  isLiked,
  type LikedStory,
  likeKey,
  type LikesSync,
  setLikesUser,
  toggleLike,
} from "./likes";

// The likes store: likes persist, a swallowed persist still holds for the
// session, a corrupt stored value reads as an empty store, and a signed-in
// reader's likes live in the database without device likes leaking in.

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

test("malformed liked-story entries are ignored instead of reading as liked", () => {
  const { backing, restore } = installStorage({ failWrites: false });
  const url = "https://example.com/malformed-entry";
  try {
    backing.set(
      LIKES_KEY,
      JSON.stringify({
        version: 1,
        likes: {
          [likeKey(url)]: null,
        },
      }),
    );

    assert.equal(isLiked(likeKey(url)), false);
  } finally {
    restore();
  }
});

for (const { name, raw } of [
  { name: "likes is null", raw: JSON.stringify({ version: 1, likes: null }) },
  {
    name: "likes is a string",
    raw: JSON.stringify({ version: 1, likes: "oops" }),
  },
  { name: "the whole store is null", raw: "null" },
  { name: "the store is not JSON", raw: "{not valid json" },
]) {
  test(`a corrupt store (${name}) reads as empty and the next like replaces it`, () => {
    const { backing, restore } = installStorage({ failWrites: false });
    const url = `https://example.com/corrupt-${encodeURIComponent(name)}`;
    try {
      backing.set(LIKES_KEY, raw);
      assert.equal(isLiked(likeKey(url)), false);

      assert.equal(
        toggleLike({ url, headline: "H", source: "example.com", topic: "AI" }),
        true,
      );
      const stored = JSON.parse(backing.get(LIKES_KEY) as string);
      assert.deepEqual(Object.keys(stored.likes), [likeKey(url)]);
    } finally {
      restore();
    }
  });
}

function memorySync(stories: LikedStory[] = []) {
  const sent: string[] = [];
  const sync: LikesSync = {
    async list() {
      return stories;
    },
    async add(story) {
      sent.push(`add ${story.key}`);
    },
    async remove(key) {
      sent.push(`remove ${key}`);
    },
  };
  return { sync, sent };
}

const story = (url: string) => ({
  url,
  headline: "H",
  source: "example.com",
  topic: "AI",
});

test("signed in, likes load from the database and each toggle is sent there", async () => {
  const { backing, restore } = installStorage({ failWrites: false });
  const saved = "https://example.com/saved-in-db";
  const db = memorySync([
    { ...story(saved), key: likeKey(saved), likedAt: "2026-11-20T10:00:00Z" },
  ]);
  try {
    await setLikesUser("user-anna", db.sync);
    assert.equal(isLiked(likeKey(saved)), true);
    const fresh = "https://example.com/fresh";
    toggleLike(story(fresh));
    toggleLike(story(saved));
    assert.deepEqual(db.sent, [
      `add ${likeKey(fresh)}`,
      `remove ${likeKey(saved)}`,
    ]);
    assert.ok(backing.has(`${LIKES_KEY}:user-anna`));
    assert.equal(backing.has(LIKES_KEY), false);
  } finally {
    await setLikesUser(null);
    restore();
  }
});

test("device likes are never uploaded, and a reader's likes leave with them", async () => {
  const { backing, restore } = installStorage({ failWrites: false });
  const local = "https://example.com/liked-signed-out";
  const annas = "https://example.com/annas";
  try {
    await setLikesUser(null);
    toggleLike(story(local));

    // Anna signs in: her likes come from the database, not the device's.
    const anna = memorySync();
    await setLikesUser("user-anna", anna.sync);
    assert.equal(isLiked(likeKey(local)), false);
    assert.deepEqual(anna.sent, []);
    toggleLike(story(annas));

    // Switching to Ben drops Anna's local copy; Ben sees none of hers.
    const ben = memorySync();
    await setLikesUser("user-ben", ben.sync);
    assert.equal(backing.has(`${LIKES_KEY}:user-anna`), false);
    assert.equal(isLiked(likeKey(annas)), false);
    assert.deepEqual(ben.sent, []);

    // Signed out again: Ben's copy is gone and the device's likes are back.
    await setLikesUser(null);
    assert.equal(backing.has(`${LIKES_KEY}:user-ben`), false);
    assert.equal(isLiked(likeKey(local)), true);
  } finally {
    restore();
  }
});
