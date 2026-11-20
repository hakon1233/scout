// POST /voice through the Worker's routes, with fetch routed by URL to a stub
// database and a stub Workers AI binding. No network, never the real model.
// The limits themselves are SQL (supabase/tests/voice.test.sql); here the
// stub database refuses the way begin_voice_clip does.

import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/http.ts";
import {
  MAX_VOICE_BYTES,
  VOICE_USED_UP,
  WHISPER_MODEL,
  type VoiceAi,
} from "../src/voice.ts";

const SUPABASE = "https://ref.supabase.test";
const ORIGIN = "https://app.example.test";
const USER = "00000000-0000-0000-0000-0000000000a1";
const CLIP = "00000000-0000-0000-0000-0000000000d1";

type Call = { url: string; auth: string; body: unknown };

// A stub Supabase: Auth answers for USER (or 401), begin_voice_clip reserves
// a clip until `clipsLeft` runs out or `neuronsLeft` drops under a minute.
function stubSupabase(
  over: { userOk?: boolean; clipsLeft?: number; neuronsLeft?: number } = {},
) {
  const calls: Call[] = [];
  let clipsLeft = over.clipsLeft ?? 5;
  let neuronsLeft = over.neuronsLeft ?? 9000;
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, auth: headers.authorization, body });
    const path = new URL(url).pathname;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === "/auth/v1/user")
      return over.userOk === false
        ? new Response("{}", { status: 401 })
        : ok({ id: USER });
    if (path === "/rest/v1/rpc/begin_voice_clip") {
      if (clipsLeft <= 0) return ok({ blocked: "user" });
      if (neuronsLeft < 47) return ok({ blocked: "global" });
      clipsLeft -= 1;
      neuronsLeft -= 47;
      return ok({ id: CLIP });
    }
    if (path === "/rest/v1/rpc/finish_voice_clip") return ok(null);
    return new Response("unknown", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function stubAi(
  answer: Awaited<ReturnType<VoiceAi["run"]>> | Error = {
    text: " Follow Norwegian football. ",
    transcription_info: { duration: 12.5 },
  },
) {
  const runs: { model: string; audio: string }[] = [];
  const ai: VoiceAi = {
    async run(model, input) {
      runs.push({ model, audio: input.audio });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { ai, runs };
}

function setup(
  opts: {
    db?: Parameters<typeof stubSupabase>[0];
    ai?: Parameters<typeof stubAi>[0];
    noAi?: boolean;
  } = {},
) {
  const db = stubSupabase(opts.db);
  const ai = stubAi(opts.ai);
  const send = (init: RequestInit = {}) =>
    handleRequest(
      new Request("https://worker.test/voice", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          authorization: "Bearer jwt-1",
          "content-type": "audio/webm",
        },
        body: new Uint8Array([1, 2, 3, 4]),
        ...init,
      }),
      {
        supabaseUrl: SUPABASE,
        anonKey: "anon",
        allowedOrigin: ORIGIN,
        serviceKey: "service",
        fetch: db.fetch,
        ...(opts.noAi ? {} : { ai: ai.ai }),
      },
    );
  return { send, db, runs: ai.runs };
}

test("a clip comes back as text and records what it cost", async () => {
  const { send, db, runs } = setup();
  const res = await send();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.deepEqual(await res.json(), { text: "Follow Norwegian football." });

  assert.deepEqual(runs, [
    { model: WHISPER_MODEL, audio: btoa("\x01\x02\x03\x04") },
  ]);
  const begin = db.calls.find((c) => c.url.endsWith("/rpc/begin_voice_clip"));
  assert.deepEqual(begin?.body, { p_user: USER });
  assert.equal(begin?.auth, "Bearer service");
  const finish = db.calls.find((c) => c.url.endsWith("/rpc/finish_voice_clip"));
  // 12.5 s at 46.63 neurons a minute.
  assert.deepEqual(finish?.body, { p_id: CLIP, p_neurons: 10 });
});

test("no sign-in, no clip", async () => {
  const { send, runs } = setup();
  const res = await send({
    headers: { origin: ORIGIN, "content-type": "audio/webm" },
  });
  assert.equal(res.status, 401);

  const bad = setup({ db: { userOk: false } });
  assert.equal((await bad.send()).status, 401);
  assert.equal(runs.length + bad.runs.length, 0);
});

test("a clip over the size cap is refused unread", async () => {
  const { send, db, runs } = setup();
  const res = await send({ body: new Uint8Array(MAX_VOICE_BYTES + 1) });
  assert.equal(res.status, 413);
  assert.equal(runs.length, 0);
  assert.ok(!db.calls.some((c) => c.url.includes("/rpc/")));
});

test("a reader's sixth clip in a day is refused with the plain message", async () => {
  const { send, runs } = setup({ db: { clipsLeft: 5 } });
  for (let i = 0; i < 5; i++) assert.equal((await send()).status, 200);
  const res = await send();
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: VOICE_USED_UP });
  assert.equal(runs.length, 5);
});

test("the global neuron budget stops voice for everyone, with no paid fallback", async () => {
  const { send, runs } = setup({ db: { neuronsLeft: 46 } });
  const res = await send();
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: VOICE_USED_UP });
  assert.equal(runs.length, 0);
});

test("a failed model call tells the reader to type", async () => {
  const { send } = setup({ ai: new Error("3036: daily free allocation used") });
  const res = await send();
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /Type instead/);
});

test("without the AI binding /voice does not exist", async () => {
  const { send } = setup({ noAi: true });
  assert.equal((await send()).status, 404);
});

test("only audio is accepted", async () => {
  const { send, runs } = setup();
  const res = await send({
    headers: {
      origin: ORIGIN,
      authorization: "Bearer jwt-1",
      "content-type": "application/json",
    },
  });
  assert.equal(res.status, 415);
  assert.equal(runs.length, 0);
});
