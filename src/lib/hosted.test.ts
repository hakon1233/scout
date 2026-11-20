import assert from "node:assert/strict";
import test from "node:test";

import {
  allowanceLine,
  createHostedData,
  HostedError,
  type PushDevice,
  shareUrl,
} from "./hosted";

// The hosted data module over a stub fetch that plays Supabase's REST API and
// the Worker. No network, no Supabase.

const SUPABASE = "https://ref.supabase.test";
const WORKER = "https://runs.example.test";
const SESSION = { userId: "user-anna", accessToken: "jwt-anna" };

type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};
type Answer = { status?: number; body: unknown };

// Answers each request with the first route whose key the URL contains.
function stubFetch(routes: Record<string, Answer | (() => Answer)>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("no route", { status: 500 });
    const route = routes[key];
    const a = typeof route === "function" ? route() : route;
    return new Response(a.body === null ? "" : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function data(
  fetch: typeof globalThis.fetch,
  signedIn = true,
  push?: PushDevice,
) {
  return createHostedData({
    supabaseUrl: SUPABASE,
    anonKey: "anon-key",
    workerUrl: WORKER,
    session: async () => (signedIn ? SESSION : null),
    fetch,
    push,
    vapidKey: "vapid-public",
  });
}

const ALLOWANCE = {
  plan: "free",
  used: { daily_interests: 1, weekly_interests: 0, on_demand_runs_today: 1 },
  limits: {
    daily_interests: 1,
    weekly_interests: 3,
    on_demand_runs_per_day: 3,
  },
};

const RUST_SECTION = [
  "## Rust releases",
  "- `2026-11-19` — **Rust 1.92** ships with faster builds.",
  "  [blog.rust-lang.org — Rust 1.92](https://blog.rust-lang.org/1.92)",
  "",
].join("\n");

test("home lists the interests with their run state and builds one brief from the latest sections", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/interests": {
      body: [
        ownRow("i-rust", "Rust releases", "daily"),
        {
          ...ownRow("i-eu", "EU AI Act", "weekly"),
          visibility: "shared",
          share_slug: "s".repeat(32),
        },
      ],
    },
    "/rest/v1/follows": {
      body: [
        {
          interests: {
            ...ownRow("p-space", "Space launches", "daily"),
            visibility: "public",
          },
        },
      ],
    },
    "/rest/v1/rpc/allowance": { body: ALLOWANCE },
    "/rest/v1/profiles": { body: [{ is_admin: true, timezone_set: true }] },
    "/rest/v1/notifications": {
      body: [
        {
          id: "n1",
          payload: { topic: "Oslo jazz", doc: "Gigs" },
          created_at: "2026-11-20T06:00:00Z",
        },
      ],
    },
    "/rest/v1/runs": {
      body: [
        // Newest first.
        run("r4", "i-eu", "running"),
        run("r3", "i-rust", "ready", RUST_SECTION, "2026-11-20T07:03:00Z"),
        run("r2", "p-space", "failed"),
        run("r1", "i-rust", "ready", "## Rust releases\nold\n"),
      ],
    },
  });
  const home = await data(fetch).home();

  assert.deepEqual(
    home.interests.map((i) => [i.topic, i.cadence, i.following, i.run]),
    [
      ["Rust releases", "daily", false, null],
      ["EU AI Act", "weekly", false, "running"],
      ["Space launches", "off", true, null],
    ],
  );
  assert.deepEqual(
    home.interests.map((i) => [i.visibility, i.shareSlug]),
    [
      ["private", null],
      ["shared", "s".repeat(32)],
      ["public", null],
    ],
  );
  assert.equal(home.isAdmin, true);
  assert.deepEqual(home.notices, [
    { id: "n1", topic: "Oslo jazz", createdAt: "2026-11-20T06:00:00Z" },
  ]);
  const notices = calls.find((c) => c.url.includes("/rest/v1/notifications"));
  assert.match(
    notices?.url ?? "",
    /kind=in\.\(unshared,deleted,stopped\)&read_at=is\.null/,
  );
  assert.equal(home.interests[0].updatedAt, "2026-11-20T07:03:00Z");
  assert.equal(home.interests[1].updatedAt, null);
  assert.match(home.interests[2].failed ?? "", /failed/);

  assert.ok(home.brief);
  assert.equal(home.brief.id, "hosted-r3");
  assert.match(home.brief.markdown, /^# Your brief\n\n## Rust releases/);
  assert.deepEqual(home.brief.interests, ["Rust releases"]);
  assert.equal(home.brief.articles[0].url, "https://blog.rust-lang.org/1.92");

  assert.deepEqual(home.allowance.daily, { used: 1, limit: 1 });
  const runs = calls.find((c) => c.url.includes("/rest/v1/runs"));
  assert.match(runs?.url ?? "", /interest_id=in\.\(i-rust,i-eu,p-space\)/);
  for (const c of calls) {
    assert.equal(c.headers.authorization, "Bearer jwt-anna");
    assert.equal(c.headers.apikey, "anon-key");
  }
  const own = calls.find((c) => c.url.includes("/rest/v1/interests"));
  assert.match(own?.url ?? "", /owner_id=eq\.user-anna&deleted_at=is\.null/);
});

test("a first-time reader has no interests, no brief and asks for no runs", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/interests": { body: [] },
    "/rest/v1/follows": { body: [] },
    "/rest/v1/rpc/allowance": { body: ALLOWANCE },
    "/rest/v1/profiles": { body: [] },
    "/rest/v1/notifications": { body: [] },
  });
  const home = await data(fetch).home();
  assert.deepEqual(home.interests, []);
  assert.equal(home.isAdmin, false);
  assert.deepEqual(home.notices, []);
  assert.equal(home.brief, null);
  assert.ok(!calls.some((c) => c.url.includes("/runs")));
});

test("setting a schedule over the plan's limit says so in plain words", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/interests": {
      status: 400,
      body: {
        code: "P0001",
        message: "quota: 1 of 1 daily interests used",
        hint: "daily_interests",
      },
    },
  });
  await assert.rejects(
    data(fetch).setCadence("i-eu", "daily"),
    (e: unknown) => {
      assert.ok(e instanceof HostedError);
      assert.equal(e.kind, "limit");
      assert.equal(
        e.message,
        "Your plan has room for 1 daily interest, and it's in use. Set one to weekly or pause it first.",
      );
      return true;
    },
  );
  assert.equal(calls[0].method, "PATCH");
  assert.match(calls[0].url, /interests\?id=eq\.i-eu$/);
  assert.deepEqual(calls[0].body, { cadence: "daily" });
});

test("restoring past the plan's interest cap says so in plain words", async () => {
  const { fetch } = stubFetch({
    "/rest/v1/interests": {
      status: 400,
      body: {
        code: "P0001",
        message: "quota: 15 of 15 interests used",
        hint: "max_interests",
      },
    },
  });
  await assert.rejects(data(fetch).restore("i-rust"), (e: unknown) => {
    assert.ok(e instanceof HostedError);
    assert.equal(e.kind, "limit");
    assert.equal(
      e.message,
      "Your plan has room for 15 interests, and they're in use. Delete one first.",
    );
    return true;
  });
});

test("delete is a soft delete that restore undoes", async () => {
  const { fetch, calls } = stubFetch({ "/rest/v1/interests": { body: null } });
  const d = data(fetch);
  await d.remove("i-rust");
  await d.restore("i-rust");
  assert.equal(
    typeof (calls[0].body as { deleted_at: string }).deleted_at,
    "string",
  );
  assert.deepEqual(calls[1].body, { deleted_at: null });
});

test("run now goes to the Worker; the daily limit comes back in plain words", async () => {
  let over = false;
  const { fetch, calls } = stubFetch({
    "/runs": () =>
      over
        ? {
            status: 429,
            body: {
              error: "request_run: quota: 3 of 3 on-demand runs used today",
            },
          }
        : { status: 202, body: { runId: "r9" } },
  });
  const d = data(fetch);
  await d.runNow("i-rust");
  assert.equal(calls[0].url, `${WORKER}/runs`);
  assert.deepEqual(calls[0].body, { interestId: "i-rust" });
  assert.equal(calls[0].headers.authorization, "Bearer jwt-anna");

  over = true;
  await assert.rejects(d.runNow("i-rust"), {
    name: "HostedError",
    message: "You've used today's 3 runs. Scheduled briefs still come.",
  });
});

test("a Worker that can't be reached says so, not to check your connection", async () => {
  const fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof globalThis.fetch;
  const d = data(fetch);
  await assert.rejects(d.runNow("i-rust"), {
    name: "HostedError",
    message: "Scout's server can't be reached right now. Try again later.",
  });
});

test("chat and confirm go to the Worker and return its turn", async () => {
  const turn = {
    id: "t1",
    created_at: "2026-11-20T08:00:00Z",
    status: "ready",
    message: "Rust releases",
    reply: "Added Rust releases.",
  };
  const { fetch, calls } = stubFetch({
    "/chat/confirm": { status: 409, body: { error: "nothing waiting" } },
    "/chat": { body: turn },
  });
  const d = data(fetch);
  assert.deepEqual(await d.chat("Rust releases"), turn);
  assert.deepEqual(calls[0].body, { message: "Rust releases" });
  await assert.rejects(d.confirm({ kind: "rewrite", interestId: "i-rust" }), {
    name: "HostedError",
  });
});

test("the transcript comes back oldest first from the stored rows", async () => {
  const row = (id: string, at: string) => ({
    id,
    created_at: at,
    status: "ready",
    message: id,
    reply: "ok",
    changes: null,
    pending: null,
    error_msg: null,
  });
  const { fetch } = stubFetch({
    "/rest/v1/chat_turns": {
      body: [
        row("b", "2026-11-20T09:00:00Z"),
        row("a", "2026-11-20T08:00:00Z"),
      ],
    },
  });
  const turns = await data(fetch).transcript();
  assert.deepEqual(
    turns.map((t) => t.id),
    ["a", "b"],
  );
});

test("signed out or a dead session is a signed-out error", async () => {
  const { fetch } = stubFetch({ "/rest/v1/": { status: 401, body: {} } });
  await assert.rejects(data(fetch, false).home(), { name: "HostedError" });
  await assert.rejects(data(fetch).home(), (e: unknown) => {
    assert.ok(e instanceof HostedError);
    assert.equal(e.kind, "signed-out");
    return true;
  });
});

test("sharing sets visibility through the RPC and returns the link's slug", async () => {
  const slug = "a".repeat(32);
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/set_sharing": { body: slug },
  });
  assert.equal(await data(fetch).setVisibility("i-rust", "shared"), slug);
  assert.deepEqual(calls[0].body, {
    p_interest: "i-rust",
    p_visibility: "shared",
  });
  assert.equal(calls[0].headers.authorization, "Bearer jwt-anna");
});

test("publishing is refused in the web app: only Scout's server publishes", async () => {
  const { fetch, calls } = stubFetch({});
  await assert.rejects(data(fetch).setVisibility("i-rust", "public"), (e) => {
    assert.ok(e instanceof HostedError);
    assert.equal(e.kind, "failed");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("the first home sets the browser's time zone once; Settings sets it later", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/interests": { body: [] },
    "/rest/v1/follows": { body: [] },
    "/rest/v1/rpc/allowance": { body: ALLOWANCE },
    "/rest/v1/profiles": { body: [{ is_admin: false, timezone_set: false }] },
    "/rest/v1/notifications": { body: [] },
    "/rest/v1/rpc/set_timezone": { body: "Europe/Oslo" },
  });
  await data(fetch).home();
  const first = calls.filter((c) => c.url.endsWith("/rpc/set_timezone"));
  assert.equal(first.length, 1);
  const body = first[0].body as { p_tz: unknown; p_first_time: unknown };
  assert.equal(body.p_first_time, true);
  assert.equal(typeof body.p_tz, "string");

  await data(fetch).setTimeZone("Europe/Oslo");
  assert.deepEqual(calls.at(-1)?.body, { p_tz: "Europe/Oslo" });
});

test("push per topic goes through set_topic_push", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/set_topic_push": { body: true },
  });
  await data(fetch).setTopicPush("i-rust", true);
  assert.deepEqual(calls[0].body, { p_interest: "i-rust", p_on: true });
});

test("delete account asks the Worker with the reader's session", async () => {
  const { fetch, calls } = stubFetch({
    "/account/delete": { body: { deleted: true } },
  });
  await data(fetch).deleteAccount();
  assert.equal(calls[0].url, `${WORKER}/account/delete`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, "Bearer jwt-anna");
});

test("a share link reads signed out with the anon key, and builds its brief", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/interest_by_slug": {
      body: {
        id: "i-rust",
        topic: "Rust releases",
        visibility: "public",
        owned: false,
        following: false,
        run: {
          id: "r3",
          section_md: RUST_SECTION,
          coverage: { topic: "Rust releases", status: "covered" },
          finished_at: "2026-11-20T07:03:00Z",
        },
      },
    },
  });
  const shared = await data(fetch, false).shared("slug-1");
  assert.equal(calls[0].headers.authorization, "Bearer anon-key");
  assert.deepEqual(calls[0].body, { p_slug: "slug-1" });
  assert.equal(shared?.topic, "Rust releases");
  assert.equal(shared?.brief?.id, "hosted-r3");
  assert.equal(shared?.brief?.generatedAt, "2026-11-20T07:03:00Z");
  assert.equal(
    shared?.brief?.articles[0].url,
    "https://blog.rust-lang.org/1.92",
  );
});

test("a share link signed in uses the session; an unknown link is null", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/interest_by_slug": { body: null },
  });
  assert.equal(await data(fetch).shared("gone"), null);
  assert.equal(calls[0].headers.authorization, "Bearer jwt-anna");
});

test("follow needs a session; a link that stopped working says so", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/follow": () =>
      calls.length > 1
        ? {
            status: 404,
            body: { code: "P0002", message: "follow: no such shared interest" },
          }
        : { body: "i-rust" },
  });
  await assert.rejects(data(fetch, false).follow("slug-1"), (e: unknown) => {
    assert.ok(e instanceof HostedError);
    assert.equal(e.kind, "signed-out");
    return true;
  });
  assert.equal(await data(fetch).follow("slug-1"), "i-rust");
  assert.deepEqual(calls[0].body, { p_slug: "slug-1" });
  await assert.rejects(data(fetch).follow("slug-1"), {
    message: "That's no longer shared. Ask whoever sent it for a new link.",
  });
});

test("hosting a stopped interest yourself respects the plan; dismiss marks it read", async () => {
  let full = false;
  const { fetch, calls } = stubFetch({
    "/rest/v1/rpc/host_copy": () =>
      full
        ? {
            status: 400,
            body: {
              code: "P0001",
              message: "quota: 15 of 15 interests used",
              hint: "max_interests",
            },
          }
        : { body: "i-new" },
    "/rest/v1/notifications": { body: null },
  });
  const d = data(fetch);
  assert.equal(await d.hostCopy("n1"), "i-new");
  assert.deepEqual(calls[0].body, { p_notification: "n1" });
  full = true;
  await assert.rejects(d.hostCopy("n1"), (e: unknown) => {
    assert.ok(e instanceof HostedError);
    assert.equal(e.kind, "limit");
    assert.match(e.message, /room for 15 interests/);
    return true;
  });
  await d.dismiss("n1");
  const patch = calls[2];
  assert.equal(patch.method, "PATCH");
  assert.match(patch.url, /notifications\?id=eq\.n1$/);
  assert.equal(typeof (patch.body as { read_at: string }).read_at, "string");
});

test("a share URL opens the public brief page", () => {
  assert.equal(shareUrl("abc"), "/i/?s=abc");
});

test("allowanceLine says what is left in plain words", () => {
  assert.equal(
    allowanceLine({
      plan: "free",
      daily: { used: 1, limit: 1 },
      weekly: { used: 1, limit: 3 },
      runsToday: { used: 2, limit: 3 },
    }),
    "Free plan: 0 of 1 daily and 2 of 3 weekly slots free. 1 run left today.",
  );
});

function ownRow(id: string, topic: string, cadence: string) {
  return { id, topic, cadence, visibility: "private", share_slug: null };
}

function run(
  id: string,
  interestId: string,
  status: string,
  section: string | null = null,
  finishedAt: string | null = null,
) {
  return {
    id,
    interest_id: interestId,
    status,
    section_md: section,
    coverage: section ? { topic: "Rust releases", status: "covered" } : null,
    error_msg: null,
    created_at: finishedAt ?? "2026-11-19T07:00:00Z",
    finished_at: finishedAt,
  };
}

// A browser's push side, played in memory: permission, install state and the
// one subscription a device holds.
function stubDevice(over: Partial<PushDevice> = {}) {
  const state = {
    permission: "default" as NotificationPermission,
    answer: "granted" as NotificationPermission,
    sub: null as { endpoint: string; p256dh: string; auth: string } | null,
    subscribedWith: "",
  };
  const device: PushDevice = {
    supported: true,
    needsInstall: false,
    permission: () => state.permission,
    requestPermission: async () => (state.permission = state.answer),
    subscription: async () => state.sub,
    subscribe: async (key) => {
      state.subscribedWith = key;
      return (state.sub = {
        endpoint: "https://push.example.test/anna-phone",
        p256dh: "p256-anna",
        auth: "auth-anna",
      });
    },
    unsubscribe: async () => {
      const endpoint = state.sub?.endpoint ?? null;
      state.sub = null;
      return endpoint;
    },
    ...over,
  };
  return { device, state };
}

test("turning notifications on asks permission, subscribes and saves the device", async () => {
  const { fetch, calls } = stubFetch({
    "/rpc/save_push_subscription": { body: null },
  });
  const { device, state } = stubDevice();
  const d = data(fetch, true, device);

  assert.equal(await d.pushStatus(), "off");
  assert.equal(await d.pushEnable(), "on");
  assert.equal(state.subscribedWith, "vapid-public");
  assert.deepEqual(calls[0].body, {
    p_endpoint: "https://push.example.test/anna-phone",
    p_p256dh: "p256-anna",
    p_auth: "auth-anna",
  });
  assert.equal(await d.pushStatus(), "on");
});

test("turning notifications off unsubscribes and deletes the saved device", async () => {
  const { fetch, calls } = stubFetch({
    "/rest/v1/push_subscriptions": { body: null },
  });
  const { device, state } = stubDevice();
  state.permission = "granted";
  state.sub = {
    endpoint: "https://push.example.test/a?b",
    p256dh: "p",
    auth: "a",
  };

  assert.equal(await data(fetch, true, device).pushDisable(), "off");
  assert.equal(state.sub, null);
  assert.equal(calls[0].method, "DELETE");
  assert.ok(
    calls[0].url.endsWith(
      "/rest/v1/push_subscriptions?endpoint=eq." +
        encodeURIComponent("https://push.example.test/a?b"),
    ),
  );
});

test("a reader who says no to notifications is told it is blocked, and nothing is saved", async () => {
  const { fetch, calls } = stubFetch({});
  const { device, state } = stubDevice();
  state.answer = "denied";
  const d = data(fetch, true, device);

  assert.equal(await d.pushEnable(), "denied");
  assert.equal(await d.pushStatus(), "denied");
  assert.equal(state.sub, null);
  assert.equal(calls.length, 0);
});

test("an iPhone not on the Home Screen needs Scout installed first; a browser without push has none", async () => {
  const { fetch } = stubFetch({});
  const iphone = stubDevice({ supported: false, needsInstall: true }).device;
  assert.equal(await data(fetch, true, iphone).pushStatus(), "needs-install");
  const old = stubDevice({ supported: false }).device;
  assert.equal(await data(fetch, true, old).pushStatus(), "unsupported");
  assert.equal(await data(fetch, true).pushStatus(), "unsupported");
});

test("a device the server would not save is unsubscribed again", async () => {
  const { fetch } = stubFetch({
    "/rpc/save_push_subscription": { status: 500, body: { message: "x" } },
  });
  const { device, state } = stubDevice();
  await assert.rejects(data(fetch, true, device).pushEnable(), HostedError);
  assert.equal(state.sub, null);
});
