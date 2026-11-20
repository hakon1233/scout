// researchInterest through its interface, with recorded API responses. No
// network, no API key: every call goes to recordedClient or a stub fetch.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  anthropicClient,
  recordedClient,
  researchInterest,
  type ClaudeClient,
  type MessagesResponse,
} from "../src/index.ts";
import { checkResearchOutput } from "../../agent/eval/checks.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
const INTEREST = {
  topic: "Open-source AI agents",
  doc: "Releases and standards from open-source agent projects.",
};

const trondheimRun = JSON.parse(
  readFileSync(
    new URL("./fixtures/trondheim-run.json", import.meta.url),
    "utf8",
  ),
) as MessagesResponse[];

const pausedRun = JSON.parse(
  readFileSync(new URL("./fixtures/paused-run.json", import.meta.url), "utf8"),
) as MessagesResponse[];

// One end_turn response whose answer is `text`.
function answer(
  text: string,
  usage: Partial<MessagesResponse["usage"]> = {},
): MessagesResponse {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 500, ...usage },
  };
}

function stop(stop_reason: string): MessagesResponse {
  return {
    content: [{ type: "text", text: "partial" }],
    stop_reason,
    usage: { input_tokens: 1000, output_tokens: 100 },
  };
}

const STORY = (date: string, n: number) =>
  `- \`${date}\` — Story ${n} happened.\n  [example.org — Story ${n}](https://example.org/${n})\n  > Lead ${n}.\n`;

test("a paused run resumes and returns the topic's section, newest first", async () => {
  const claude = recordedClient(pausedRun);
  const result = await researchInterest(INTEREST, { claude, now: NOW });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.coverage, {
    topic: INTEREST.topic,
    status: "covered",
  });
  const md = result.sectionMd ?? "";
  // Canonical heading, no lead-in, newest story first.
  assert.match(md, /^## Open-source AI agents\n/);
  assert.doesNotMatch(md, /I have enough/);
  assert.ok(md.indexOf("`2026-11-18`") < md.indexOf("`2026-11-12`"));
  // The prompt's rules hold for this output (the same checks as `pnpm eval`).
  const failed = checkResearchOutput(md, {
    topic: INTEREST.topic,
    today: "2026-11-20",
  }).filter((c) => !c.pass);
  assert.deepEqual(failed, []);
});

test("the request: Haiku, capped web tools, cached prompt, resumed turn sent back unchanged", async () => {
  const claude = recordedClient(pausedRun);
  await researchInterest(INTEREST, { claude, now: NOW, maxSearches: 3 });

  assert.equal(claude.requests.length, 2);
  const [first, second] = claude.requests;
  assert.equal(first.model, "claude-haiku-5-5");
  assert.deepEqual(first.tools, [
    { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    {
      type: "web_fetch_20250910",
      name: "web_fetch",
      max_uses: 5,
      // Caps each fetched page so a run stays well under the 100K-token
      // prompt line where Haiku's long-prompt rates (5×) start.
      max_content_tokens: 6000,
    },
  ]);
  const prompt = first.messages[0].content[0];
  assert.deepEqual(prompt.cache_control, { type: "ephemeral" });
  assert.match(String(prompt.text), /<intent-doc>\nReleases and standards/);
  assert.match(String(prompt.text), /Today's date is 2026-11-20/);
  // The prompt names the API's server tools, not the claude CLI's.
  assert.match(String(prompt.text), /the web_search tool/);
  assert.match(String(prompt.text), /web_fetch on the/);
  assert.doesNotMatch(String(prompt.text), /WebSearch|WebFetch/);
  assert.equal(first.messages.length, 1);
  // pause_turn: same user message, then the paused assistant content as is,
  // with no extra "continue" message.
  assert.deepEqual(second.messages, [
    first.messages[0],
    { role: "assistant", content: pausedRun[0].content },
  ]);
});

test("usage sums every response and prices it from the table", async () => {
  const result = await researchInterest(INTEREST, {
    claude: recordedClient(pausedRun),
    now: NOW,
  });
  const { costUsd, ...counts } = result.usage;
  assert.deepEqual(counts, {
    inputTokens: 14_200,
    outputTokens: 3_300,
    cacheReadTokens: 3_000,
    cacheWriteTokens: 3_000,
    webSearches: 1,
    webFetches: 1,
  });
  // Input 14,200 × $0.10/M + cache write 3,000 × $0.125/M + cache read
  // 3,000 × $0.01/M + output 3,300 × $0.50/M + 1 search × $0.01.
  assert.ok(Math.abs(costUsd - 0.013475) < 1e-9, `costUsd ${costUsd}`);
});

test("stories written without their bullet still parse as dated stories", async () => {
  // Haiku sometimes drops the `- ` before a story's date (seen in a real
  // run): the brief then parsed as zero stories yet counted as covered.
  const loose = (date: string, n: number) =>
    `\`${date}\` — Story ${n} happened. [example.org — Story ${n}](https://example.org/${n})\n` +
    `![source image](https://example.org/${n}.jpg)\n\n` +
    `> **Lead ${n}.**\n>\n> One.\n>\n> Two.\n>\n> Three.\n`;
  const result = await researchInterest(INTEREST, {
    claude: recordedClient([
      answer(
        `## Open-source AI agents\n\n${loose("2026-11-19", 1)}\n${loose("2026-11-18", 2)}\n${loose("2026-09-01", 3)}`,
      ),
    ]),
    now: NOW,
  });
  const md = result.sectionMd ?? "";
  const failed = checkResearchOutput(md, {
    topic: INTEREST.topic,
    today: "2026-11-20",
  }).filter((c) => !c.pass);
  assert.deepEqual(failed, []);
  assert.match(md, /^- `2026-11-19` — Story 1/m);
  // Freshness sees them too: the stale one is dropped.
  assert.doesNotMatch(md, /Story 3/);
});

test("a prompt over 100K tokens is billed at the long-prompt rates", async () => {
  const result = await researchInterest(INTEREST, {
    claude: recordedClient([
      answer(`## Open-source AI agents\n${STORY("2026-11-19", 1)}`, {
        input_tokens: 120_000,
        output_tokens: 2_000,
      }),
    ]),
    now: NOW,
  });
  // 120,000 × $0.50/M + 2,000 × $2.50/M.
  assert.ok(Math.abs(result.usage.costUsd - 0.065) < 1e-9);
});

test("stale stories are dropped; a topic left with none is empty", async () => {
  const result = await researchInterest(INTEREST, {
    claude: recordedClient([
      answer(
        `## Open-source AI agents\n${STORY("2026-09-01", 1)}${STORY("2026-08-20", 2)}`,
      ),
    ]),
    now: NOW,
  });
  assert.equal(result.sectionMd, "## Open-source AI agents\n_no fresh news_\n");
  assert.equal(result.coverage.status, "empty");
});

test("an interest that asks for background keeps older stories", async () => {
  const result = await researchInterest(
    { ...INTEREST, doc: "Background and history of agent runtimes." },
    {
      claude: recordedClient([
        answer(`## Open-source AI agents\n${STORY("2026-09-01", 1)}`),
      ]),
      now: NOW,
    },
  );
  assert.match(result.sectionMd ?? "", /2026-09-01/);
  assert.equal(result.coverage.status, "covered");
});

test("every web tool failing makes the topic missing, not empty", async () => {
  const result = await researchInterest(INTEREST, {
    claude: recordedClient([
      {
        content: [
          {
            type: "server_tool_use",
            id: "s1",
            name: "web_search",
            input: { query: "q" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "s1",
            content: {
              type: "web_search_tool_result_error",
              error_code: "unavailable",
            },
          },
          { type: "text", text: "## Open-source AI agents\n_no fresh news_" },
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 4000,
          output_tokens: 200,
          server_tool_use: { web_search_requests: 0 },
        },
      },
    ]),
    now: NOW,
  });
  assert.equal(result.sectionMd, null);
  assert.equal(result.coverage.status, "missing");
  assert.equal(result.error, "web tools failed: unavailable");
  assert.ok(result.usage.costUsd > 0, "the failed call is still costed");
});

test("refusal, max_tokens and endless pausing fail the topic with the cost kept", async () => {
  const cases: Array<[MessagesResponse[], string]> = [
    [[stop("refusal")], "Claude refused"],
    [[stop("max_tokens")], "the section was cut off at max_tokens"],
    [Array(4).fill(stop("pause_turn")), "still paused after 3 continuations"],
  ];
  for (const [responses, error] of cases) {
    const claude = recordedClient(responses);
    const result = await researchInterest(INTEREST, { claude, now: NOW });
    assert.equal(result.error, error);
    assert.equal(result.coverage.status, "missing");
    assert.equal(result.usage.inputTokens, 1000 * responses.length);
    assert.equal(claude.requests.length, responses.length);
  }
});

test("a client error or an empty answer fails the topic", async () => {
  const broken: ClaudeClient = {
    createMessage: async () => {
      throw new Error("Claude API 529: overloaded_error: Overloaded");
    },
  };
  const a = await researchInterest(INTEREST, { claude: broken, now: NOW });
  assert.equal(a.error, "Claude API 529: overloaded_error: Overloaded");
  assert.equal(a.coverage.status, "missing");

  const b = await researchInterest(INTEREST, {
    claude: recordedClient([answer("   ")]),
    now: NOW,
  });
  assert.equal(b.error, "Claude returned no section");
});

test("the call is cut off at the timeout", async () => {
  const hanging: ClaudeClient = {
    createMessage: (_req, signal) =>
      new Promise((_resolve, reject) => {
        // A pending request keeps the process alive, as a real fetch would.
        const pending = setTimeout(() => {}, 60_000);
        signal.addEventListener("abort", () => {
          clearTimeout(pending);
          reject(signal.reason);
        });
      }),
  };
  const result = await researchInterest(INTEREST, {
    claude: hanging,
    now: NOW,
    timeoutMs: 20,
  });
  assert.equal(result.error, "timed out after 0 s");
  assert.equal(result.coverage.status, "missing");
});

test("anthropicClient posts to the Messages API and surfaces API errors", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const replies = [
    new Response(JSON.stringify(pausedRun[1]), { status: 200 }),
    new Response(
      JSON.stringify({
        type: "error",
        error: { type: "rate_limit_error", message: "slow down" },
      }),
      { status: 429 },
    ),
  ];
  const client = anthropicClient({
    apiKey: "test-key",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return replies.shift()!;
    },
  });
  const request = {
    model: "claude-haiku-5-5",
    max_tokens: 10,
    messages: [],
    tools: [],
  };
  const signal = new AbortController().signal;

  const res = await client.createMessage(request, signal);
  assert.equal(res.stop_reason, "end_turn");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.signal, signal);
  assert.deepEqual(calls[0].init.headers, {
    "x-api-key": "test-key",
    "anthropic-version": "2026-10-21",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), request);

  await assert.rejects(client.createMessage(request, signal), {
    message: "Claude API 429: rate_limit_error: slow down",
  });
});

test("a story citing a site's homepage is dropped (recorded Trondheim run)", async () => {
  // A real run listed Samfundet's homepage as a story dated today. A story is
  // one dated item; a homepage or listing page is not one.
  const result = await researchInterest(
    {
      topic: "NTNU and Trondheim student events",
      doc: "What's on this week for NTNU students in Trondheim.",
    },
    { claude: recordedClient(trondheimRun), now: NOW },
  );
  const md = result.sectionMd ?? "";
  assert.doesNotMatch(md, /\(https:\/\/www\.samfundet\.no\/\)/);
  assert.doesNotMatch(md, /Samfundet's listings/);
  // The article stories stay.
  assert.match(md, /^- `2026-11-19` — Exams started at NTNU/m);
  assert.match(md, /^- `2026-11-18` — NTNU has switched off/m);
  assert.equal(result.coverage.status, "covered");
});
