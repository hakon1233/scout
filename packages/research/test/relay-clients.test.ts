// The local account relay's two clients: captureRequest stops a function at its
// model call and hands back the request; replayClient answers that call once
// with the Mac's text. No network.

import test from "node:test";
import assert from "node:assert/strict";
import {
  captureRequest,
  replayClient,
  type ClaudeClient,
  type MessagesRequest,
} from "../src/index.ts";

const REQUEST: MessagesRequest = {
  model: "claude-haiku-5-5",
  max_tokens: 100,
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
};

test("captureRequest hands back the request and runs nothing after the call", async () => {
  let after = false;
  const out = await captureRequest(async (claude: ClaudeClient) => {
    await claude.createMessage(REQUEST, AbortSignal.timeout(60_000));
    after = true;
    return "done";
  });
  assert.deepEqual(out, { captured: REQUEST });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(after, false);
});

test("captureRequest returns the function's result when it made no call", async () => {
  assert.deepEqual(await captureRequest(async () => 7), { done: 7 });
});

test("captureRequest rethrows a failure before the call", async () => {
  await assert.rejects(
    captureRequest(async () => {
      throw new Error("store down");
    }),
    /store down/,
  );
});

test("replayClient answers once with the text and the given tokens", async () => {
  const claude = replayClient({
    text: '{"ok":true}',
    usage: { input_tokens: 12, output_tokens: 3 },
  });
  const res = await claude.createMessage(REQUEST, new AbortController().signal);
  assert.deepEqual(res, {
    content: [{ type: "text", text: '{"ok":true}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 12, output_tokens: 3 },
  });
  await assert.rejects(
    claude.createMessage(REQUEST, new AbortController().signal),
    /already used/,
  );
});

test("replayClient passes a cut-off stop reason through", async () => {
  const res = await replayClient({
    text: "{",
    usage: { input_tokens: 1, output_tokens: 1 },
    stopReason: "max_tokens",
  }).createMessage(REQUEST, new AbortController().signal);
  assert.equal(res.stop_reason, "max_tokens");
});
