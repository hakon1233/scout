// The Mac's gateway (scripts/local-server.mjs + local-relay.ts) end to end: a
// throwaway site and a stubbed Worker on ephemeral loopback ports, and a
// stubbed `claude`. No network, no real claude, never 47821 or 47900.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { startLocalServer } from "../../../scripts/local-server.mjs";
import type { RelayModelRequest } from "#core";
import { createWorkerProxy, relayPromptText } from "../src/local-relay.js";

const TOKEN = "relay-secret-do-not-print";
const JWT = "Bearer jwt-anna";
const SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" } },
  required: ["reply"],
};
const REQUEST: RelayModelRequest = {
  model: "claude-haiku-5-5",
  max_tokens: 1000,
  messages: [{ role: "user", content: [{ type: "text", text: "PROMPT-1" }] }],
  output_config: { format: { type: "json_schema", schema: SCHEMA } },
};

// A `claude` that answers `--output-format json` with `structured_output`.
function stubClaude(opts: { fail?: string; slowMs?: number } = {}) {
  const spawns: Array<{ args: readonly string[]; prompt: string }> = [];
  let running = 0;
  let most = 0;
  const spawnFn = ((_bin: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let prompt = "";
    child.stdin = new Writable({
      write(c, _e, cb) {
        prompt += c.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => {
      spawns.push({ args, prompt });
      most = Math.max(most, ++running);
      setTimeout(() => {
        running--;
        if (opts.fail) {
          child.stderr.emit("data", Buffer.from(opts.fail));
          child.emit("close", 1);
          return;
        }
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              num_turns: 2,
              result: "ignored",
              structured_output: { reply: `answered ${prompt}` },
              usage: { input_tokens: 10, output_tokens: 20 },
              modelUsage: {
                "claude-haiku-5-5": {
                  inputTokens: 10,
                  outputTokens: 20,
                  cacheReadInputTokens: 3,
                  cacheCreationInputTokens: 4,
                },
              },
            }),
          ),
        );
        child.emit("close", 0);
      }, opts.slowMs ?? 0);
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnFn, spawns, most: () => most };
}

type Seen = {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
};

// The Worker, as a loopback server that plays the relay protocol.
async function stubWorker(
  opts: { promptStatus?: number; noRelay?: boolean } = {},
) {
  const seen: Seen[] = [];
  let turns = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body,
      });
      const json = (status: number, b: unknown, h = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...h });
        res.end(JSON.stringify(b));
      };
      const step = req.headers["x-scout-relay"];
      if (step && req.headers["x-scout-relay-token"] !== TOKEN)
        return json(401, { error: "bad token" });
      if (step === "prompt") {
        if (opts.promptStatus)
          return json(opts.promptStatus, {
            error: "limit",
            message: "Used up.",
          });
        if (opts.noRelay)
          return json(200, { id: "t0", reply: "No call needed." });
        return json(
          200,
          { turnId: `turn-${++turns}`, request: REQUEST },
          { "x-scout-relay": "prompt" },
        );
      }
      if (step === "answer") {
        const a = JSON.parse(body) as { turnId: string; text: string };
        return json(
          200,
          { id: a.turnId, path: req.url, reply: a.text },
          {
            "x-worker": "yes",
          },
        );
      }
      json(200, { plain: req.url, method: req.method });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, seen };
}

function site() {
  const root = mkdtempSync(path.join(os.tmpdir(), "scout-gateway-site-"));
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(path.join(root, "app", "index.html"), "app shell");
  writeFileSync(path.join(root, "_headers"), "/*\n  X-Frame-Options: DENY\n");
  return root;
}

async function withGateway(
  worker: Awaited<ReturnType<typeof stubWorker>>,
  claude: ReturnType<typeof stubClaude>,
  fn: (
    call: (p: string, init?: RequestInit) => Promise<Response>,
  ) => Promise<void>,
  extra: { timeoutMs?: number } = {},
) {
  const logs: string[] = [];
  const gateway: Server = await startLocalServer({
    root: site(),
    port: 0,
    proxy: createWorkerProxy({
      workerUrl: worker.url,
      token: TOKEN,
      spawnFn: claude.spawnFn,
      log: (l) => logs.push(l),
      ...extra,
    }),
  });
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  try {
    await fn((p, init) => fetch(base + p, init));
  } finally {
    gateway.close();
    worker.server.close();
  }
  assert.doesNotMatch(logs.join("\n"), new RegExp(TOKEN));
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: {
    authorization: JWT,
    "content-type": "application/json",
    ...headers,
  },
  body: JSON.stringify(body),
});

test("a chat turn: prompt step, the Mac's claude, answer step, the Worker's answer", async () => {
  const worker = await stubWorker();
  const claude = stubClaude();
  await withGateway(worker, claude, async (call) => {
    // A browser can't pose as the relay: its relay headers are dropped.
    const res = await call(
      "/chat",
      post({ message: "Rust releases" }, { "x-scout-relay-token": "guess" }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-worker"), "yes");
    assert.equal(res.headers.get("x-scout-relay"), null);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), {
      id: "turn-1",
      path: "/chat",
      reply: JSON.stringify({ reply: "answered PROMPT-1" }),
    });
    assert.doesNotMatch(text, new RegExp(TOKEN));
  });

  const [prompt, answer] = worker.seen;
  assert.equal(worker.seen.length, 2);
  assert.equal(prompt.headers["x-scout-relay"], "prompt");
  assert.equal(prompt.headers.authorization, JWT);
  assert.deepEqual(JSON.parse(prompt.body), { message: "Rust releases" });
  assert.equal(answer.headers["x-scout-relay"], "answer");
  assert.equal(answer.headers.authorization, JWT);
  assert.deepEqual(JSON.parse(answer.body), {
    turnId: "turn-1",
    text: JSON.stringify({ reply: "answered PROMPT-1" }),
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    },
  });

  const { args, prompt: sent } = claude.spawns[0];
  assert.equal(sent, "PROMPT-1");
  assert.deepEqual(
    args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2),
    ["--tools", ""],
  );
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.deepEqual(JSON.parse(args[args.indexOf("--json-schema") + 1]), SCHEMA);
});

test("publish goes through the relay too", async () => {
  const worker = await stubWorker();
  const claude = stubClaude();
  await withGateway(worker, claude, async (call) => {
    const res = await call("/publish", post({ interestId: "i-1" }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { path: string }).path, "/publish");
  });
  assert.deepEqual(
    worker.seen.map((s) => s.headers["x-scout-relay"]),
    ["prompt", "answer"],
  );
});

test("a prompt step with no model call, and every other route, pass straight through", async () => {
  for (const opts of [{ promptStatus: 429 }, { noRelay: true }]) {
    const worker = await stubWorker(opts);
    const claude = stubClaude();
    await withGateway(worker, claude, async (call) => {
      const res = await call("/chat", post({ message: "x" }));
      assert.equal(res.status, opts.promptStatus ?? 200);
      assert.ok((await res.text()).length > 0);
    });
    assert.equal(worker.seen.length, 1);
    assert.equal(claude.spawns.length, 0);
  }

  const worker = await stubWorker();
  const claude = stubClaude();
  await withGateway(worker, claude, async (call) => {
    const res = await call("/chat/confirm?x=1", post({ kind: "rewrite" }));
    assert.deepEqual(await res.json(), {
      plain: "/chat/confirm?x=1",
      method: "POST",
    });
    // GETs are the site's, not the Worker's.
    const page = await call("/app/");
    assert.equal(await page.text(), "app shell");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
  });
  assert.equal(worker.seen.length, 1);
  assert.equal(worker.seen[0].headers["x-scout-relay"], undefined);
  assert.equal(worker.seen[0].headers["x-scout-relay-token"], undefined);
  assert.equal(worker.seen[0].headers.authorization, JWT);
  assert.equal(claude.spawns.length, 0);
});

test("claude failing or timing out answers 503 with a plain sentence and sends no answer", async () => {
  const cases = [
    {
      claude: stubClaude({ fail: "You've hit your usage limit" }),
      said: /usage limit/,
    },
    { claude: stubClaude({ fail: "boom" }), said: /couldn't answer/ },
    {
      claude: stubClaude({ slowMs: 200 }),
      said: /took too long/,
      timeoutMs: 20,
    },
  ];
  for (const c of cases) {
    const worker = await stubWorker();
    await withGateway(
      worker,
      c.claude,
      async (call) => {
        const res = await call("/chat", post({ message: "x" }));
        assert.equal(res.status, 503);
        const { error } = (await res.json()) as { error: string };
        assert.match(error, c.said);
        assert.doesNotMatch(error, /boom|exited/);
      },
      { timeoutMs: c.timeoutMs },
    );
    assert.deepEqual(
      worker.seen.map((s) => s.headers["x-scout-relay"]),
      ["prompt"],
    );
  }
});

test("turns wait for each other: one claude at a time", async () => {
  const worker = await stubWorker();
  const claude = stubClaude({ slowMs: 30 });
  await withGateway(worker, claude, async (call) => {
    const all = await Promise.all(
      [1, 2, 3].map(() => call("/chat", post({ message: "x" }))),
    );
    assert.deepEqual(
      all.map((r) => r.status),
      [200, 200, 200],
    );
  });
  assert.equal(claude.spawns.length, 3);
  assert.equal(claude.most(), 1);
});

test("an unreachable Worker is a 502 with a plain sentence", async () => {
  const worker = await stubWorker();
  worker.server.close();
  await withGateway(worker, stubClaude(), async (call) => {
    const res = await call("/chat", post({ message: "x" }));
    assert.equal(res.status, 502);
    assert.match(
      ((await res.json()) as { error: string }).error,
      /can't be reached/,
    );
  });
});

test("a multi-message request becomes one prompt that says who said what", () => {
  assert.equal(
    relayPromptText({
      ...REQUEST,
      messages: [
        { role: "user", content: [{ type: "text", text: "a" }] },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
      ],
    }),
    "User:\na\n\nAssistant:\nb",
  );
});
