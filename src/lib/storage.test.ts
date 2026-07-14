import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings, saveSettings } from "./storage";

const SETTINGS_KEY = "scout.settings.v1";

function withStorage(
  entries: Record<string, string>,
  fn: (writes: Map<string, string>) => void,
) {
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
    fn(writes);
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

test("loadSettings preserves a valid saved profile and drops removed API-key fields", () => {
  withStorage(
    {
      [SETTINGS_KEY]: JSON.stringify({
        name: "Ada",
        interests: [{ id: "int_ai", topic: "AI safety" }],
        anthropicKey: "old",
        exaKey: "old",
      }),
    },
    () => {
      assert.deepEqual(loadSettings(), {
        name: "Ada",
        interests: [{ id: "int_ai", topic: "AI safety" }],
      });
    },
  );
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

test("saveSettings writes the current profile shape", () => {
  withStorage({}, (writes) => {
    saveSettings({
      name: "Ada",
      interests: [{ id: "int_ai", topic: "AI safety" }],
    });

    assert.equal(
      writes.get(SETTINGS_KEY),
      JSON.stringify({
        name: "Ada",
        interests: [{ id: "int_ai", topic: "AI safety" }],
      }),
    );
  });
});
