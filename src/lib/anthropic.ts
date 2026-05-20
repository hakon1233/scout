import type { Article } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

const SYSTEM_BRIEF = `You are Notiva, an agent that writes personalized news briefs.

Goal: turn a batch of recent articles into a short, scannable brief for the reader, focused only on the topics they care about.

Rules:
- Output GitHub-flavored Markdown. Start with a single H1 line "# Your brief".
- Group items under H2 headings, one per topic the reader picked. Skip topics with no relevant articles instead of inventing items.
- Under each topic, write 1–4 bullets. Each bullet: one sentence summarising the development, then on a new line a markdown link to the source like "[domain.com — Title](url)". Cite at most one source per bullet.
- Drop items that are clearly off-topic, paywalled stubs with no substance, or duplicates.
- No filler, no "in conclusion", no editorial opinions. Plain, factual, useful.
- If fewer than 2 topics have anything worth reporting, still produce a brief but add a one-line italic note at the top explaining the thin coverage.
- Keep the whole brief under ~500 words.`;

type SynthesizeOptions = {
  apiKey: string;
  name: string;
  interests: string[];
  articles: Article[];
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function synthesizeBrief(opts: SynthesizeOptions): Promise<string> {
  const { apiKey, name, interests, articles, timeoutMs = 60_000, signal } = opts;

  const userBlock = renderUserPrompt(name, interests, articles);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: [
          {
            type: "text",
            text: SYSTEM_BRIEF,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userBlock }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n")
      .trim();

    if (!text) throw new Error("Anthropic returned empty brief");
    return text;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

function renderUserPrompt(
  name: string,
  interests: string[],
  articles: Article[],
): string {
  const lines: string[] = [];
  lines.push(`Reader: ${name || "Reader"}`);
  lines.push(`Topics the reader picked:`);
  for (const t of interests) lines.push(`- ${t}`);
  lines.push("");
  lines.push(`Recent articles (one per item, grouped by topic the agent queried):`);
  lines.push("");

  for (const a of articles) {
    lines.push(`### [${a.interest}] ${a.title}`);
    lines.push(`URL: ${a.url}`);
    if (a.source) lines.push(`Source: ${a.source}`);
    if (a.publishedDate) lines.push(`Published: ${a.publishedDate}`);
    if (a.text) {
      const trimmed = a.text.replace(/\s+/g, " ").slice(0, 1200);
      lines.push(`Excerpt: ${trimmed}`);
    }
    lines.push("");
  }

  lines.push(
    `Write the brief for this reader now. Only include topics in the list above. Cite each item with its URL.`,
  );
  return lines.join("\n");
}
