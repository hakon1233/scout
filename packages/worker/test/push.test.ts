// Pushes from the outbox through their interface: sendOutbox over a stub store
// and a stub fetch that plays the push services, and the Supabase push store
// over a stub fetch. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  briefReadyPayload,
  sendOutbox,
  weeklyPayload,
  type OutboxPush,
  type PushStore,
} from "../src/push.ts";
import { dailyJobs, supabasePushStore } from "../src/supabase.ts";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString("base64url");

// A VAPID key pair and a browser's subscription keys, made fresh per run.
async function keys() {
  const vapid = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const browser = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  return {
    vapid: {
      publicKey: b64url(await crypto.subtle.exportKey("raw", vapid.publicKey)),
      privateKey: jwk.d as string,
    },
    p256dh: b64url(await crypto.subtle.exportKey("raw", browser.publicKey)),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

function stubStore(items: OutboxPush[]) {
  const claimed: number[] = [];
  const dropped: string[][] = [];
  const store: PushStore = {
    async claim(limit) {
      claimed.push(limit);
      return items.slice(0, limit);
    },
    async drop(endpoints) {
      dropped.push(endpoints);
    },
  };
  return { store, claimed, dropped };
}

// Answers each push with the status its endpoint names (…/gone-410 → 410).
function pushServices() {
  const sent: { url: string; headers: Headers; bytes: number }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: new Headers(init.headers),
      bytes: (init.body as Uint8Array).byteLength,
    });
    const status = Number(/-(\d{3})$/.exec(url)?.[1] ?? 201);
    if (status === 599) throw new Error("connection reset");
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

const ready = (
  k: Awaited<ReturnType<typeof keys>>,
  endpoint: string,
): OutboxPush => ({
  endpoint,
  p256dh: k.p256dh,
  auth: k.auth,
  kind: "push",
  payload: { run_id: "run-1", topic: "Trondheim events" },
});

test("each queued push goes out encrypted, signed with the VAPID key", async () => {
  const k = await keys();
  const { store, claimed } = stubStore([
    ready(k, "https://push.example.test/hana"),
    {
      ...ready(k, "https://push.example.test/ben"),
      kind: "weekly",
      payload: { count: 1, topics: ["Oslo jazz"], popular: [] },
    },
  ]);
  const { fetch, sent } = pushServices();
  const n = await sendOutbox({
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    budget: 39,
    fetch,
  });

  assert.equal(n, 2);
  assert.deepEqual(claimed, [37]);
  assert.deepEqual(sent.map((s) => s.url).sort(), [
    "https://push.example.test/ben",
    "https://push.example.test/hana",
  ]);
  for (const s of sent) {
    assert.equal(s.headers.get("content-encoding"), "aes128gcm");
    assert.match(
      s.headers.get("authorization") ?? "",
      new RegExp(
        `^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${k.vapid.publicKey}$`,
      ),
    );
    assert.ok(Number(s.headers.get("ttl")) > 0);
    assert.ok(s.bytes > 0);
  }
});

test("the push says the brief is ready and names the topic", () => {
  assert.deepEqual(briefReadyPayload("Trondheim events"), {
    title: "Your brief is ready",
    body: "New stories on Trondheim events.",
  });
});

test("the weekly push names the reader's topics and what is popular", () => {
  assert.deepEqual(
    weeklyPayload({
      count: 7,
      topics: ["A", "B", "C", "D", "E"],
      popular: [{ title: "Oslo jazz" }, { title: "Fjord kayaking" }],
    }),
    {
      title: "New this week in your topics",
      body: "New stories on A, B, C, D, E and 2 more. Popular now: Oslo jazz, Fjord kayaking.",
    },
  );
  assert.equal(
    weeklyPayload({ count: 1, topics: ["A"], popular: [] }).body,
    "New stories on A.",
  );
});

test("the weekly push names the reader's picks in place of popular topics", () => {
  const picks = [{ title: "Fjord kayaking" }, { title: "Ski touring" }];
  assert.deepEqual(
    weeklyPayload({
      count: 2,
      topics: ["A", "B"],
      popular: [{ title: "Oslo jazz" }],
      picks,
    }),
    {
      title: "New this week in your topics",
      body: "New stories on A, B. Picked for you: Fjord kayaking, Ski touring.",
    },
  );
  // Picks alone (no fresh briefs) still make one push.
  assert.deepEqual(
    weeklyPayload({ count: 0, topics: [], popular: [], picks }),
    {
      title: "Picked for you this week",
      body: "Picked for you: Fjord kayaking, Ski touring.",
    },
  );
});

test("a device the push service no longer knows (404, 410) is deleted; other failures are left alone", async () => {
  const k = await keys();
  const { store, dropped } = stubStore([
    ready(k, "https://push.example.test/ok"),
    ready(k, "https://push.example.test/gone-410"),
    ready(k, "https://push.example.test/unknown-404"),
    ready(k, "https://push.example.test/busy-429"),
    ready(k, "https://push.example.test/down-599"),
  ]);
  const { fetch } = pushServices();
  const n = await sendOutbox({
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    budget: 39,
    fetch,
  });

  assert.equal(n, 1);
  assert.deepEqual(
    dropped.map((d) => [...d].sort()),
    [
      [
        "https://push.example.test/gone-410",
        "https://push.example.test/unknown-404",
      ],
    ],
  );
});

test("an empty outbox means no pushes and no deletes", async () => {
  const { store, dropped } = stubStore([]);
  const { fetch, sent } = pushServices();
  await sendOutbox({
    store,
    vapid: { publicKey: "", privateKey: "" },
    subject: "https://scout.example.test",
    budget: 39,
    fetch,
  });
  assert.equal(sent.length, 0);
  assert.equal(dropped.length, 0);
});

test("pushes stay within the tick's subrequest budget", async () => {
  const k = await keys();
  const many = Array.from({ length: 10 }, (_, n) =>
    ready(k, `https://push.example.test/d${n}`),
  );
  const { store, claimed } = stubStore(many);
  const { fetch, sent } = pushServices();
  const opts = {
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    fetch,
  };

  await sendOutbox({ ...opts, budget: 6 }); // 1 claim, 4 pushes, 1 delete
  assert.equal(sent.length, 4);
  await sendOutbox({ ...opts, budget: 2 }); // no room for a push
  assert.deepEqual(claimed, [4]);
});

test("the daily job cleans up every day and queues the weekly push on Mondays", async () => {
  const called: string[] = [];
  const fetch = (async (url: string) => {
    called.push(new URL(url).pathname);
    return new Response("3");
  }) as unknown as typeof globalThis.fetch;
  const opts = { url: "https://ref.supabase.test", serviceKey: "k", fetch };

  assert.deepEqual(
    await dailyJobs({ ...opts, now: new Date("2026-11-24T03:17:00Z") }),
    { runsDeleted: 3, weeklyPicks: 0, weeklyQueued: 0 },
  );
  assert.deepEqual(
    await dailyJobs({ ...opts, now: new Date("2026-11-23T03:17:00Z") }),
    { runsDeleted: 3, weeklyPicks: 3, weeklyQueued: 3 },
  );
  // Monday marks active readers for picks first, so their push waits.
  assert.deepEqual(called, [
    "/rest/v1/rpc/cleanup_runs",
    "/rest/v1/rpc/cleanup_runs",
    "/rest/v1/rpc/start_weekly_picks",
    "/rest/v1/rpc/queue_weekly_pushes",
  ]);
});

test("the Supabase push store claims the outbox and deletes gone devices with the service key", async () => {
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
    });
    return url.includes("/rpc/claim_outbox")
      ? new Response(
          JSON.stringify([
            {
              endpoint: "https://e/1",
              p256dh: "p",
              auth: "a",
              kind: "push",
              payload: { run_id: "r", topic: "T" },
            },
          ]),
        )
      : new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const store = supabasePushStore({
    url: "https://ref.supabase.test",
    serviceKey: "service-key",
    fetch,
  });

  assert.deepEqual(await store.claim(5), [
    {
      endpoint: "https://e/1",
      p256dh: "p",
      auth: "a",
      kind: "push",
      payload: { run_id: "r", topic: "T" },
    },
  ]);
  await store.drop(["https://e/1,x", 'https://e/"2"']);

  assert.equal(
    calls[0].url,
    "https://ref.supabase.test/rest/v1/rpc/claim_outbox",
  );
  assert.equal(calls[0].headers.get("authorization"), "Bearer service-key");
  assert.equal(calls[1].method, "DELETE");
  const url = new URL(calls[1].url);
  assert.equal(url.pathname, "/rest/v1/push_subscriptions");
  assert.equal(
    url.searchParams.get("endpoint"),
    'in.("https://e/1,x","https://e/\\"2\\"")',
  );
  assert.equal(calls[1].headers.get("apikey"), "service-key");
});
