import assert from "node:assert/strict";
import test from "node:test";

import {
  loadLastBrief,
  loadSettings,
  saveLastBrief,
  saveSettings,
} from "./storage";

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";

function withStorage(entries: Record<string, string>, fn: () => void) {
  const previousWindow = globalThis.window;
  const writes = new Map(Object.entries(entries));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          return writes.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          writes.set(key, value);
        },
        removeItem(key: string) {
          writes.delete(key);
        },
      },
    },
  });

  try {
    fn();
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    } else {
      // @ts-expect-error Restoring the Node test environment.
      delete globalThis.window;
    }
  }
}

test("loadSettings drops removed API-key fields, and a saved profile loads back unchanged", () => {
  const profile = {
    name: "Ada",
    interests: [{ id: "int_ai", topic: "AI safety" }],
  };
  withStorage(
    {
      [SETTINGS_KEY]: JSON.stringify({
        ...profile,
        anthropicKey: "old",
        exaKey: "old",
      }),
    },
    () => {
      assert.deepEqual(loadSettings(), profile);
    },
  );
  withStorage({}, () => {
    saveSettings(profile);
    assert.deepEqual(loadSettings(), profile);
  });
});

test("loadSettings rejects syntactically valid but malformed settings", () => {
  for (const raw of [
    "[]",
    JSON.stringify({ name: "Ada", interests: "AI safety" }),
    JSON.stringify({ name: 42, interests: [] }),
    JSON.stringify({ name: "Ada", interests: [{ id: "int_ai" }] }),
    JSON.stringify({ name: "Ada", interests: [{ id: 7, topic: "AI safety" }] }),
  ]) {
    withStorage({ [SETTINGS_KEY]: raw }, () => {
      assert.equal(loadSettings(), null);
    });
  }
});

test("a saved brief loads back unchanged", () => {
  const brief = {
    id: "brief_1",
    generatedAt: "2026-07-14T08:00:00.000Z",
    interests: ["AI safety"],
    articles: [],
    markdown: "## AI safety",
  };

  withStorage({}, () => {
    saveLastBrief(brief);
    assert.deepEqual(loadLastBrief(), brief);
  });
});

test("loadLastBrief rejects syntactically valid but malformed cached briefs", () => {
  for (const raw of [
    "[]",
    JSON.stringify({
      id: "brief_1",
      generatedAt: 7,
      interests: [],
      articles: [],
      markdown: "",
    }),
    JSON.stringify({
      id: "brief_1",
      generatedAt: "2026-07-14T08:00:00.000Z",
      interests: "AI safety",
      articles: [],
      markdown: "",
    }),
    JSON.stringify({
      id: "brief_1",
      generatedAt: "2026-07-14T08:00:00.000Z",
      interests: [],
      articles: "not an array",
      markdown: "",
    }),
    JSON.stringify({
      id: "brief_1",
      generatedAt: "2026-07-14T08:00:00.000Z",
      interests: [],
      articles: [{ id: "a1", title: "Story" }],
      markdown: "",
    }),
  ]) {
    withStorage({ [BRIEF_KEY]: raw }, () => {
      assert.equal(loadLastBrief(), null);
    });
  }
});
