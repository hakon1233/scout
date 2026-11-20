// "Your brief is ready" pushes through their interface: the notifier over a
// stub store and a stub fetch that plays the push services, and the Supabase
// push store over a stub fetch. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  briefReadyNotifier,
  briefReadyPayload,
  type PushStore,
  type PushTarget,
} from "../src/push.ts";
import { supabasePushStore } from "../src/supabase.ts";

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

function stubStore(targets: PushTarget[]) {
  const asked: string[] = [];
  const dropped: string[][] = [];
  const store: PushStore = {
    async targets(runId) {
      asked.push(runId);
      return targets;
    },
    async drop(endpoints) {
      dropped.push(endpoints);
    },
  };
  return { store, asked, dropped };
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

const target = (
  k: Awaited<ReturnType<typeof keys>>,
  endpoint: string,
): PushTarget => ({
  endpoint,
  p256dh: k.p256dh,
  auth: k.auth,
  topic: "Trondheim events",
});

test("a ready run's readers each get one encrypted push, signed with the VAPID key", async () => {
  const k = await keys();
  const { store, asked } = stubStore([
    target(k, "https://push.example.test/hana"),
    target(k, "https://push.example.test/ben"),
  ]);
  const { fetch, sent } = pushServices();
  const notify = briefReadyNotifier({
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    fetch,
  });

  await notify("run-1");

  assert.deepEqual(asked, ["run-1"]);
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

test("a device the push service no longer knows (404, 410) is deleted; other failures are left alone", async () => {
  const k = await keys();
  const { store, dropped } = stubStore([
    target(k, "https://push.example.test/ok"),
    target(k, "https://push.example.test/gone-410"),
    target(k, "https://push.example.test/unknown-404"),
    target(k, "https://push.example.test/busy-429"),
    target(k, "https://push.example.test/down-599"),
  ]);
  const { fetch } = pushServices();
  const notify = briefReadyNotifier({
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    fetch,
  });

  await notify("run-1");

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

test("no readers to tell means no pushes and no deletes", async () => {
  const { store, dropped } = stubStore([]);
  const { fetch, sent } = pushServices();
  await briefReadyNotifier({
    store,
    vapid: { publicKey: "", privateKey: "" },
    subject: "https://scout.example.test",
    fetch,
  })("run-1");
  assert.equal(sent.length, 0);
  assert.equal(dropped.length, 0);
});

test("pushes stay within the tick's subrequest budget", async () => {
  const k = await keys();
  const many = Array.from({ length: 10 }, (_, n) =>
    target(k, `https://push.example.test/d${n}`),
  );
  const { store } = stubStore(many);
  const { fetch, sent } = pushServices();
  const notify = briefReadyNotifier({
    store,
    vapid: k.vapid,
    subject: "https://scout.example.test",
    fetch,
    budget: 5,
  });

  await notify("run-1"); // 1 for the targets, 4 pushes
  await notify("run-2"); // nothing left

  assert.equal(sent.length, 4);
});

test("the Supabase push store lists targets and deletes gone devices with the service key", async () => {
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
    });
    return url.includes("/rpc/push_targets")
      ? new Response(
          JSON.stringify([
            { endpoint: "https://e/1", p256dh: "p", auth: "a", topic: "T" },
          ]),
        )
      : new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const store = supabasePushStore({
    url: "https://ref.supabase.test",
    serviceKey: "service-key",
    fetch,
  });

  assert.deepEqual(await store.targets("run-1"), [
    { endpoint: "https://e/1", p256dh: "p", auth: "a", topic: "T" },
  ]);
  await store.drop(["https://e/1,x", 'https://e/"2"']);

  assert.equal(
    calls[0].url,
    "https://ref.supabase.test/rest/v1/rpc/push_targets",
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
