// fetchCompanionInterestSet: where the UI's interest list comes from when the
// companion serves this page. The companion is a fetch stub on this origin.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchCompanionInterestSet } from "./interest-docs";

const origin = "http://scout.test";
Object.defineProperty(globalThis, "window", {
  value: { location: { origin } },
  configurable: true,
});

function serve(routes: Record<string, () => Response>) {
  globalThis.fetch = async (input) => {
    const path = String(input).slice(origin.length);
    return routes[path]?.() ?? new Response(null, { status: 404 });
  };
}

const ok = () => new Response(null, { status: 200 });

test("the full set from /v0/interests wins, with real ids and doc metadata", async () => {
  serve({
    "/healthz": ok,
    "/v0/interests": () =>
      Response.json({
        interests: [
          {
            id: "int_a1",
            topic: "AI safety",
            hasDoc: true,
            docUpdatedAt: "2026-10-01T00:00:00.000Z",
            doc: "# AI safety",
          },
        ],
      }),
  });
  const set = await fetchCompanionInterestSet("tok", [
    { id: "local-ai", topic: "AI safety" },
  ]);
  assert.deepEqual(set, {
    interests: [{ id: "int_a1", topic: "AI safety" }],
    meta: {
      int_a1: {
        hasDoc: true,
        updatedAt: "2026-10-01T00:00:00.000Z",
        body: "# AI safety",
      },
    },
  });
});

test("without /v0/interests, the /v0/config topics keep local ids and key new topics", async () => {
  serve({
    "/healthz": ok,
    "/v0/config": () =>
      Response.json({ interests: ["Climate tech", "ai safety"] }),
  });
  const set = await fetchCompanionInterestSet("", [
    { id: "local-ai", topic: "AI safety" },
  ]);
  assert.deepEqual(set, {
    interests: [
      { id: "climate-tech", topic: "Climate tech" },
      { id: "local-ai", topic: "AI safety" },
    ],
    meta: {},
  });
});
