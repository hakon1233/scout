import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmDeleteInterest,
  confirmRewriteInterest,
  type ChatTurn,
} from "./chat";

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

  await confirmDeleteInterest("int_ai", "tok", {
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
