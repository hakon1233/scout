import type { Article } from "./types";

const EXA_URL = "https://api.exa.ai/search";

type ExaResult = {
  id?: string;
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
};

export async function searchInterest(
  interest: string,
  apiKey: string,
  opts: { numResults?: number; timeoutMs?: number } = {},
): Promise<Article[]> {
  const numResults = opts.numResults ?? 5;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(EXA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: interest,
        numResults,
        type: "neural",
        useAutoprompt: true,
        startPublishedDate: isoDaysAgo(14),
        contents: { text: { maxCharacters: 1800 } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Exa ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { results?: ExaResult[] };
    const results = json.results ?? [];
    return results.map((r, i) => ({
      id: r.id ?? `${interest}-${i}`,
      title: r.title ?? r.url,
      url: r.url,
      publishedDate: r.publishedDate,
      author: r.author,
      source: hostname(r.url),
      text: r.text,
      interest,
    }));
  } finally {
    clearTimeout(timer);
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function dedupeArticles(articles: Article[]): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of articles) {
    const key = canonicalUrl(a.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return u;
  }
}
