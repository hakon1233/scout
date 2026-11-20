// Brief emails through their interface: sendEmails over a stub store and a
// stub sender, the unsubscribe route over the same store, and the Resend and
// Supabase adapters over a stub fetch. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_EMAIL_CAP,
  briefEmail,
  handleUnsubscribe,
  resendSender,
  sendEmails,
  supabaseEmailStore,
  unsubscribeUrl,
  type EmailMessage,
  type EmailSender,
  type EmailStore,
  type QueuedEmail,
} from "../src/email.ts";
import { handleRequest } from "../src/http.ts";

const SIGNING_KEY = "service-key-for-tests";
const SITE = "https://scout.test";
const WORKER = "https://worker.test";
const HANA = "aaaaaaaa-0000-4000-8000-00000000000a";
const BEN = "bbbbbbbb-0000-4000-8000-00000000000b";
const TOPIC = "11111111-0000-4000-8000-000000000001";

const SECTION = [
  "## Trondheim events",
  "- `2026-11-20` — The Christmas market opens <b>early</b>.",
  "  [adressa.no — Market opens](https://adressa.no/market?a=1&b=2)",
  "  ![source image](https://adressa.no/img.jpg)",
  "  > Stalls open on **Friday**.",
].join("\n");

function queued(over: Partial<QueuedEmail> = {}): QueuedEmail {
  return {
    id: 1,
    userId: HANA,
    to: "hana@example.test",
    interestId: TOPIC,
    topic: "Trondheim events",
    sectionMd: SECTION,
    sentToday: 0,
    ...over,
  };
}

function stubStore(items: QueuedEmail[] | null) {
  const claimed: number[] = [];
  const sent: number[][] = [];
  const unsubscribed: [string, string][] = [];
  const store: EmailStore = {
    async claim(limit) {
      claimed.push(limit);
      return items && items.slice(0, limit);
    },
    async sent(ids) {
      sent.push(ids);
    },
    async unsubscribe(userId, interestId) {
      unsubscribed.push([userId, interestId]);
      return interestId === TOPIC ? "Trondheim events" : null;
    },
  };
  return { store, claimed, sent, unsubscribed };
}

function stubSender(failFor: string[] = []) {
  const messages: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(m) {
      if (failFor.includes(m.to)) throw new Error("refused");
      messages.push(m);
    },
  };
  return { sender, messages };
}

const opts = {
  siteUrl: SITE,
  workerUrl: WORKER,
  signingKey: SIGNING_KEY,
  budget: 20,
};

test("each queued reader gets one email with the topic, the brief, a link to it and an unsubscribe link", async () => {
  const { store, sent } = stubStore([
    queued(),
    queued({ id: 2, userId: BEN, to: "ben@example.test" }),
  ]);
  const { sender, messages } = stubSender();
  assert.equal(await sendEmails({ ...opts, store, sender }), 2);

  assert.deepEqual(
    messages.map((m) => m.to),
    ["hana@example.test", "ben@example.test"],
  );
  const m = messages[0];
  assert.match(m.subject, /Trondheim events/);
  // Markdown to simple, escaped HTML: no raw tags from the brief, no images.
  assert.match(m.html, /<h2>Trondheim events<\/h2>/);
  assert.match(
    m.html,
    /<a href="https:\/\/adressa\.no\/market\?a=1&amp;b=2">adressa\.no — Market opens<\/a>/,
  );
  assert.match(m.html, /<strong>Friday<\/strong>/);
  assert.match(m.html, /&lt;b&gt;early&lt;\/b&gt;/);
  assert.doesNotMatch(m.html, /<img|<b>/);
  // A plain-text part with the same stories.
  assert.match(m.text, /The Christmas market opens/);
  assert.doesNotMatch(m.text, /<a /);
  // The link to the topic on the site, and the signed unsubscribe link.
  const topicLink = `${SITE}/app/topics/?id=${TOPIC}`;
  assert.ok(m.html.includes(topicLink) && m.text.includes(topicLink));
  const unsub = await unsubscribeUrl(WORKER, SIGNING_KEY, HANA, TOPIC);
  assert.ok(m.html.includes(unsub.replaceAll("&", "&amp;")));
  assert.ok(m.text.includes(unsub));
  assert.equal(m.headers["List-Unsubscribe"], `<${unsub}>`);
  assert.equal(
    m.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  // What was sent is marked, so it counts toward the cap.
  assert.deepEqual(sent, [[1, 2]]);
});

test("switched off: the store answers null and nothing is sent", async () => {
  const { store, sent } = stubStore(null);
  const { sender, messages } = stubSender();
  assert.equal(await sendEmails({ ...opts, store, sender }), 0);
  assert.deepEqual(messages, []);
  assert.deepEqual(sent, []);
});

test("no sender key: it logs once, claims nothing and sends nothing", async () => {
  const { store, claimed } = stubStore([queued()]);
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  assert.equal(await sendEmails({ ...opts, store, sender: null, log }), 0);
  assert.equal(await sendEmails({ ...opts, store, sender: null, log }), 0);
  assert.deepEqual(claimed, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /RESEND_API_KEY/);
});

test("the daily cap: a reader gets at most DAILY_EMAIL_CAP emails in 24 hours", async () => {
  assert.equal(DAILY_EMAIL_CAP, 20);
  const { store, sent } = stubStore([
    queued({ id: 1, sentToday: 18 }),
    queued({ id: 2, sentToday: 18 }),
    queued({ id: 3, sentToday: 18 }),
    queued({ id: 4, userId: BEN, to: "ben@example.test", sentToday: 20 }),
    queued({ id: 5, userId: BEN, to: "ben@example.test", sentToday: 0 }),
  ]);
  const { sender, messages } = stubSender();
  assert.equal(await sendEmails({ ...opts, store, sender }), 2);
  assert.deepEqual(
    messages.map((m) => m.to),
    ["hana@example.test", "hana@example.test"],
  );
  assert.deepEqual(sent, [[1, 2]]);
});

test("a failed send is not marked sent, and the others still go", async () => {
  const { store, sent } = stubStore([
    queued(),
    queued({ id: 2, userId: BEN, to: "ben@example.test" }),
  ]);
  const { sender } = stubSender(["hana@example.test"]);
  assert.equal(await sendEmails({ ...opts, store, sender, log: () => {} }), 1);
  assert.deepEqual(sent, [[2]]);
});

test("the budget: one subrequest for the claim, one for the mark, one per email", async () => {
  const { store, claimed } = stubStore([queued()]);
  const { sender } = stubSender();
  await sendEmails({ ...opts, store, sender, budget: 7 });
  assert.deepEqual(claimed, [5]);
  const none = stubStore([queued()]);
  assert.equal(
    await sendEmails({ ...opts, store: none.store, sender, budget: 2 }),
    0,
  );
  assert.deepEqual(none.claimed, []);
});

test("unsubscribe: a signed link turns that topic's email off, no sign-in", async () => {
  const { store, unsubscribed } = stubStore([]);
  const url = await unsubscribeUrl(WORKER, SIGNING_KEY, BEN, TOPIC);

  const page = await handleUnsubscribe(new Request(url), {
    store,
    signingKey: SIGNING_KEY,
  });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await page.text(), /Trondheim events/);

  // One-click from the mail app (RFC 8058) posts to the same link.
  const post = await handleUnsubscribe(
    new Request(url, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    }),
    { store, signingKey: SIGNING_KEY },
  );
  assert.equal(post.status, 200);
  assert.deepEqual(unsubscribed, [
    [BEN, TOPIC],
    [BEN, TOPIC],
  ]);
});

test("unsubscribe: a link with a wrong or borrowed signature changes nothing", async () => {
  const { store, unsubscribed } = stubStore([]);
  const good = new URL(await unsubscribeUrl(WORKER, SIGNING_KEY, BEN, TOPIC));
  const forged = new URL(good);
  forged.searchParams.set("u", HANA); // Ben's signature on Hana's id
  const otherKey = new URL(
    await unsubscribeUrl(WORKER, "another-key", BEN, TOPIC),
  );
  const missing = new URL(good);
  missing.searchParams.delete("t");
  for (const u of [forged, otherKey, missing]) {
    const res = await handleUnsubscribe(new Request(u), {
      store,
      signingKey: SIGNING_KEY,
    });
    assert.equal(res.status, 400);
  }
  assert.deepEqual(unsubscribed, []);
});

test("the Worker serves the unsubscribe route without a sign-in", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify("Trondheim events"), { status: 200 });
  }) as typeof globalThis.fetch;
  const url = await unsubscribeUrl(WORKER, "svc", BEN, TOPIC);
  const res = await handleRequest(new Request(url), {
    supabaseUrl: "https://db.test",
    anonKey: "anon",
    allowedOrigin: SITE,
    serviceKey: "svc",
    fetch,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [
    {
      url: "https://db.test/rest/v1/rpc/email_unsubscribe",
      body: { p_user: BEN, p_interest: TOPIC },
    },
  ]);
});

test("briefEmail's subject names the topic", () => {
  const m = briefEmail({
    topic: "Trondheim events",
    sectionMd: SECTION,
    topicUrl: `${SITE}/app/topics/?id=${TOPIC}`,
    unsubscribeUrl: `${WORKER}/email/unsubscribe`,
  });
  assert.equal(m.subject, "New brief: Trondheim events");
});

test("Resend adapter: one POST with the key, sender, parts and headers; a refusal throws", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status });
  }) as typeof globalThis.fetch;
  const sender = resendSender({
    apiKey: "re_test",
    from: "Scout <briefs@scout.test>",
    fetch,
  });
  const message: EmailMessage = {
    to: "hana@example.test",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    headers: { "List-Unsubscribe": "<https://worker.test/x>" },
  };
  await sender.send(message);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer re_test",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    from: "Scout <briefs@scout.test>",
    to: ["hana@example.test"],
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    headers: { "List-Unsubscribe": "<https://worker.test/x>" },
  });
  status = 422;
  await assert.rejects(sender.send(message));
});

test("Supabase store: claim_emails, emails_sent and email_unsubscribe as the service role", async () => {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const answers: Record<string, unknown> = {
    claim_emails: [
      {
        id: 7,
        user_id: HANA,
        to: "hana@example.test",
        interest_id: TOPIC,
        topic: "Trondheim events",
        section_md: SECTION,
        sent_today: 3,
      },
    ],
    emails_sent: null,
    email_unsubscribe: "Trondheim events",
  };
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: new Headers(init.headers).get("authorization"),
    });
    const fn = url.split("/").pop() as string;
    return new Response(
      answers[fn] === null ? "" : JSON.stringify(answers[fn]),
      { status: 200 },
    );
  }) as typeof globalThis.fetch;
  const store = supabaseEmailStore({
    url: "https://db.test",
    serviceKey: "svc",
    fetch,
  });
  assert.deepEqual(await store.claim(5), [queued({ id: 7, sentToday: 3 })]);
  await store.sent([7]);
  assert.equal(await store.unsubscribe(HANA, TOPIC), "Trondheim events");
  assert.deepEqual(
    calls.map((c) => [c.url.split("/").pop(), c.body, c.auth]),
    [
      ["claim_emails", { p_limit: 5 }, "Bearer svc"],
      ["emails_sent", { p_ids: [7] }, "Bearer svc"],
      ["email_unsubscribe", { p_user: HANA, p_interest: TOPIC }, "Bearer svc"],
    ],
  );
  answers.claim_emails = null;
  assert.equal(await store.claim(5), null);
});
