// On the hosted UI the companion is on loopback, not this page's origin; the
// reader's interests must still come from it.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchCompanionInterestSet } from "./interest-docs";

Object.defineProperty(globalThis, "window", {
  value: { location: { origin: "https://hosted.example" } },
  configurable: true,
});

test("the hosted UI reads the companion's interests over loopback", async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "http://127.0.0.1:47821/healthz") {
      return new Response(null, { status: 200 });
    }
    if (url === "http://127.0.0.1:47821/v0/interests") {
      const auth = (init.headers as Record<string, string>).authorization;
      return auth === "Bearer tok"
        ? Response.json({ interests: [{ id: "int_a1", topic: "AI" }] })
        : new Response(null, { status: 401 });
    }
    throw new TypeError("fetch failed");
  };
  const set = await fetchCompanionInterestSet("tok", [
    { id: "local-ai", topic: "AI" },
    { id: "local-golf", topic: "Golf" },
  ]);
  assert.deepEqual(set?.interests, [{ id: "int_a1", topic: "AI" }]);
});
