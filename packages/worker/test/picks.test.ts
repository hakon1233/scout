// The tick's picks refresh: the Supabase picks store over a stub fetch, driven
// by createPicks with a recorded Claude client. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { createPicks } from "@scout/hosted";
import { recordedClient, type MessagesResponse } from "@scout/research";
import { picksBatch } from "../src/run-due.ts";
import { supabasePicksStore } from "../src/supabase.ts";

const input = {
  profile: {},
  reading: [],
  marks: [],
  candidates: [
    { id: "i-fjord", title: "Fjord kayaking", tags: ["outdoors"], about: "" },
  ],
};

test("a tick claims at most its picks batch and records each reader's picks", async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body));
    calls.push({ path, body });
    assert.equal(new Headers(init.headers).get("apikey"), "service");
    if (path.endsWith("/claim_picks")) {
      return Response.json([
        { user_id: "pia", run_id: 7, kind: "weekly", input },
      ]);
    }
    return Response.json(1);
  }) as unknown as typeof globalThis.fetch;
  const claude = recordedClient([
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            picks: [{ topic: "c1", reason: "You like the outdoors." }],
          }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 4000, output_tokens: 300 },
    } as MessagesResponse,
  ]);
  const store = supabasePicksStore({
    url: "https://ref.supabase.test",
    serviceKey: "service",
    fetch,
  });

  const result = await createPicks({ claude, store }).refresh(picksBatch(2));

  assert.equal(result.stored, 1);
  assert.deepEqual(calls[0], {
    path: "/rest/v1/rpc/claim_picks",
    body: { p_limit: 3 },
  });
  assert.equal(calls[1].path, "/rest/v1/rpc/finish_picks");
  assert.deepEqual(
    { ...calls[1].body, p_cost: typeof calls[1].body.p_cost },
    {
      p_user: "pia",
      p_run: 7,
      p_picks: [{ interest_id: "i-fjord", reason: "You like the outdoors." }],
      p_cost: "number",
      p_error: null,
    },
  );
});
