// The web app's one way to call the companion: companionFetch and
// companionJson. The companion is a fetch stub serving this page's origin.

import test from "node:test";
import assert from "node:assert/strict";
import {
  companionFetch,
  companionJson,
  verifyCompanionToken,
} from "./companion";

const origin = "http://scout.test";
Object.defineProperty(globalThis, "window", {
  value: { location: { origin } },
  configurable: true,
});

type Seen = { url: string; init: RequestInit };

function serve(reply: (seen: Seen) => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === `${origin}/healthz`) {
      return new Response(null, { status: 200 });
    }
    const call = { url: String(input), init };
    seen.push(call);
    return reply(call);
  };
  return seen;
}

test("a request carries the bearer token and a JSON body, and returns the JSON reply", async () => {
  const seen = serve(() => Response.json({ ok: 1 }));
  const reply = await companionJson<{ ok: number }>("/v0/schedule", {
    token: "tok",
    method: "PUT",
    body: { enabled: true },
    failure: "Couldn't save",
  });
  assert.deepEqual(reply, { ok: 1 });
  assert.equal(seen[0].url, `${origin}/v0/schedule`);
  assert.equal(seen[0].init.method, "PUT");
  assert.deepEqual(seen[0].init.headers, {
    authorization: "Bearer tok",
    "content-type": "application/json",
  });
  assert.equal(seen[0].init.body, '{"enabled":true}');
});

test("a request without a body or token sends neither header", async () => {
  const seen = serve(() => new Response("{}"));
  await companionFetch("/v0/briefs");
  assert.equal(seen[0].init.method, "GET");
  assert.deepEqual(seen[0].init.headers, {});
  assert.equal(seen[0].init.body, undefined);
});

test("a caller's signal replaces the default timeout", async () => {
  const seen = serve(() => new Response("{}"));
  const controller = new AbortController();
  await companionFetch("/v0/chat", { signal: controller.signal });
  assert.equal(seen[0].init.signal, controller.signal);
});

test("a refusal throws the status's own message, else the companion's hint or error, else the failure text", async () => {
  const refuse = (status: number, body: object) => {
    serve(() => Response.json(body, { status }));
    return companionJson("/v0/chat", {
      failure: "Couldn't send that message",
      messages: { 409: "Still working on your last message." },
    });
  };
  await assert.rejects(refuse(409, { error: "chat turn in progress" }), {
    message: "Still working on your last message.",
  });
  await assert.rejects(
    refuse(400, { error: "too long", hint: "Shorten it." }),
    {
      message: "Shorten it.",
    },
  );
  await assert.rejects(refuse(400, { error: "too long" }), {
    message: "too long",
  });
  await assert.rejects(refuse(500, {}), {
    message: "Couldn't send that message (500).",
  });
});

test("a token check says whether the companion accepts the token", async () => {
  serve(
    ({ init }) =>
      new Response(null, {
        status:
          (init.headers as Record<string, string>).authorization ===
          "Bearer good"
            ? 200
            : 401,
      }),
  );
  assert.equal(await verifyCompanionToken("good"), "ok");
  assert.equal(await verifyCompanionToken("bad"), "rejected");
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await verifyCompanionToken("good"), "unreachable");
});

test("a refusal message can depend on the refusal's body", async () => {
  serve(() =>
    Response.json({ error: "x", dropped: ["Topic"] }, { status: 409 }),
  );
  await assert.rejects(
    companionJson("/v0/interests", {
      failure: "Couldn't start the run",
      messages: {
        409: (body) =>
          Array.isArray(body.dropped) ? "Interests changed." : undefined,
      },
    }),
    { message: "Interests changed." },
  );
});
