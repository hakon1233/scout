import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmDeleteInterest,
  confirmRewriteInterest,
  pollChatTurn,
} from "./chat";
import type { ChatTurn } from "@scout/agent/contract";

const origin = "http://scout.test";

function installWindow() {
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin } },
    configurable: true,
  });
}

function readyTurn(): ChatTurn {
  return {
    id: "turn_confirm",
    created_at: "2026-07-12T12:00:00.000Z",
    status: "ready",
    message: "confirmed",
  };
}

test("confirmDeleteInterest passes through a caller abort signal", async () => {
  installWindow();
  const controller = new AbortController();
  let confirmSignal: AbortSignal | null = null;

  globalThis.fetch = async (input, init) => {
    if (String(input) === `${origin}/healthz`) {
      return new Response(null, { status: 200 });
    }
    assert.equal(String(input), `${origin}/v0/chat/confirm-delete`);
    confirmSignal = init?.signal ?? null;
    return Response.json({ turn: readyTurn() });
  };

  await confirmDeleteInterest(["int_ai"], "tok", {
    signal: controller.signal,
  });

  assert.equal(confirmSignal, controller.signal);
});

test("confirmRewriteInterest passes through a caller abort signal", async () => {
  installWindow();
  const controller = new AbortController();
  let confirmSignal: AbortSignal | null = null;

  globalThis.fetch = async (input, init) => {
    if (String(input) === `${origin}/healthz`) {
      return new Response(null, { status: 200 });
    }
    assert.equal(String(input), `${origin}/v0/chat/confirm-rewrite`);
    confirmSignal = init?.signal ?? null;
    return Response.json({ turn: readyTurn() });
  };

  await confirmRewriteInterest("int_ai", "tok", {
    signal: controller.signal,
  });

  assert.equal(confirmSignal, controller.signal);
});

test("pollChatTurn passes a since= filter so the poll doesn't re-fetch the whole transcript", async () => {
  installWindow();
  const pollUrls: string[] = [];

  globalThis.fetch = async (input) => {
    if (String(input) === `${origin}/healthz`) {
      return new Response(null, { status: 200 });
    }
    pollUrls.push(String(input));
    return Response.json({ turns: [{ ...readyTurn(), id: "turn_x" }] });
  };

  await pollChatTurn("turn_x", "tok", { intervalMs: 1 });

  assert.equal(pollUrls.length, 1);
  const url = new URL(pollUrls[0]);
  assert.equal(url.pathname, "/v0/chat");
  const since = url.searchParams.get("since");
  assert.ok(since, "expected a since= query param");
  assert.ok(
    Date.parse(since) < Date.now(),
    "since should be a timestamp before now",
  );
});

test("pollChatTurn hands back a turn the companion failed, unlike a poll that gives up", async () => {
  installWindow();
  globalThis.fetch = async (input) => {
    if (String(input) === `${origin}/healthz`) {
      return new Response(null, { status: 200 });
    }
    return Response.json({
      turns: [
        { ...readyTurn(), id: "turn_old" },
        { ...readyTurn(), id: "turn_f", status: "failed", error_msg: "boom" },
      ],
    });
  };
  const turn = await pollChatTurn("turn_f", "tok", { intervalMs: 1 });
  assert.equal(turn.id, "turn_f");
  assert.equal(turn.status, "failed");

  globalThis.fetch = async (input) =>
    String(input) === `${origin}/healthz`
      ? new Response(null, { status: 200 })
      : Response.json({ turns: [] });
  await assert.rejects(
    pollChatTurn("turn_gone", "tok", { intervalMs: 1, timeoutMs: 20 }),
    /Timed out/,
  );
});
