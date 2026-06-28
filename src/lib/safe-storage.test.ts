import assert from "node:assert/strict";
import test from "node:test";

import { getLocalStorage, isClient, safeSetItem } from "./safe-storage";

test("isClient is false without a browser window", () => {
  const previousWindow = globalThis.window;
  // @ts-expect-error Testing the SSR/static-export environment.
  delete globalThis.window;

  try {
    assert.equal(isClient(), false);
    assert.equal(getLocalStorage(), null);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("safeSetItem writes through browser localStorage when present", () => {
  const writes: Array<[string, string]> = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        setItem(key: string, value: string) {
          writes.push([key, value]);
        },
      },
    },
  });

  try {
    assert.equal(isClient(), true);
    safeSetItem("key", "value");
    assert.deepEqual(writes, [["key", "value"]]);
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
});

test("getLocalStorage degrades to null when the browser blocks storage access", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis.window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });

  try {
    assert.equal(getLocalStorage(), null);
    assert.doesNotThrow(() => safeSetItem("key", "value"));
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
});
