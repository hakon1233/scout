// Try hosted research for real: one researchInterest run against the Claude
// API (Haiku, real web search and fetch), with its section, cost, Claude
// calls and brief checks. Costs real money (about $0.05 a run), so it is a
// manual tool, never part of `pnpm check`.
//
//   set -a; . ~/.config/scout-hosted/.env; set +a
//   pnpm exec tsx --conditions=source scripts/try-research.mts <out-dir> <name>
//
// <name> is one of the sample interests below. Writes <name>.md (the section),
// <name>.json (usage and checks) and <name>.responses.json (every raw API
// response) to <out-dir>. The key is read from ANTHROPIC_API_KEY only and is
// never printed or written.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  anthropicClient,
  researchInterest,
  responseCostUsd,
  type ClaudeClient,
  type MessagesResponse,
} from "../packages/research/src/index.ts";
import { checkResearchOutput } from "../packages/agent/eval/checks.ts";

// Written the way the setup chat writes an interest's intent doc.
const INTERESTS: Record<string, { topic: string; doc: string }> = {
  trondheim: {
    topic: "NTNU and Trondheim student events",
    doc: [
      "I'm a student at NTNU in Trondheim. Tell me what's on this week:",
      "concerts, talks, parties, career fairs and Samfundet events, plus NTNU",
      "news that affects students (exams, housing, campus changes).",
      "Skip national news unless it changes something in Trondheim.",
      "Norwegian sources are fine.",
    ].join("\n"),
  },
  batteries: {
    topic: "Norwegian battery and energy storage startups",
    doc: [
      "Norwegian startups in batteries and energy storage: Morrow, Freyr,",
      "Beyonder, Corvus, Cegasa and smaller ones. Funding rounds, factory",
      "news, contracts, layoffs and bankruptcies. Trade press and Norwegian",
      "business sources (E24, DN, Finansavisen) over general news.",
      "Skip EV car reviews.",
    ].join("\n"),
  },
  localllama: {
    topic: "r/LocalLLaMA highlights",
    doc: [
      "What the r/LocalLLaMA community is excited about this week: new open",
      "weights models, quantizations, benchmarks people trust, inference",
      "tools (llama.cpp, vLLM, Ollama) and hardware setups. Link the Reddit",
      "thread when there is one, and the model card or repo.",
      "Skip memes and help requests.",
    ].join("\n"),
  },
};

const [outDir, name] = process.argv.slice(2);
const interest = name ? INTERESTS[name] : undefined;
if (!outDir || !interest) {
  console.error(
    `usage: try-research.mts <out-dir> <${Object.keys(INTERESTS).join("|")}>`,
  );
  process.exit(2);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set (see the header comment).");
  process.exit(2);
}

// Counts Claude calls and keeps each raw response.
const responses: MessagesResponse[] = [];
const real = anthropicClient({ apiKey });
const claude: ClaudeClient = {
  async createMessage(request, signal) {
    const started = Date.now();
    const res = await real.createMessage(request, signal);
    responses.push(res);
    console.error(
      `call ${responses.length}: ${res.stop_reason} in ${Date.now() - started} ms, ` +
        `searches ${res.usage.server_tool_use?.web_search_requests ?? 0}, ` +
        `fetches ${res.usage.server_tool_use?.web_fetch_requests ?? 0}`,
    );
    return res;
  },
};

const now = new Date();
const started = Date.now();
const result = await researchInterest(interest, { claude, now });
const wallSeconds = (Date.now() - started) / 1000;

const today = now.toISOString().slice(0, 10);
const checks = result.sectionMd
  ? checkResearchOutput(result.sectionMd, { topic: interest.topic, today })
  : [];
const summary = {
  name,
  topic: interest.topic,
  wallSeconds,
  claudeCalls: responses.length,
  stopReasons: responses.map((r) => r.stop_reason),
  usage: result.usage,
  costFromResponses: responses.reduce(
    (s, r) => s + responseCostUsd(r.usage),
    0,
  ),
  coverage: result.coverage,
  error: result.error ?? null,
  checks,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.md`), result.sectionMd ?? "");
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(summary, null, 2));
writeFileSync(
  join(outDir, `${name}.responses.json`),
  JSON.stringify(responses, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
