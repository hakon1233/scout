import type { Article, Brief } from "./types";

// Per-interest "news found per run" (PER-191 AC2). The companion persists only
// the latest brief server-side, but the browser keeps the latest + previous
// edition (scout.lastBrief.v1 / scout.prevBrief.v1 — see storage.ts). Each
// brief's `articles[]` already carry their parsed interest + ISO `publishedAt`
// (PER-176/177), so a run history is just those briefs grouped by interest,
// newest run first — no new store, no re-parsing.

export type RunStories = {
  // The brief/run id, used as a stable React key.
  runId: string;
  // ISO timestamp the run was generated (newest first).
  generatedAt: string;
  // This interest's articles from that run, in brief order.
  articles: Article[];
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function singularizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) =>
      part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part,
    )
    .join("-");
}

// Exact-then-conservative slug equality, matching BriefView's join so an article
// whose `interest` the model capitalized/pluralized slightly differently still
// lands under the right card without treating `AI` as a substring match for
// `OpenAI`.
function slugMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return singularizeSlug(a) === singularizeSlug(b);
}

// For one interest topic, the per-run story lists (newest run first). Runs where
// the interest produced no articles are omitted — an empty run carries no signal
// for the card and would just add noise.
export function runHistoryForTopic(
  runs: ReadonlyArray<Brief>,
  topic: string,
): RunStories[] {
  const target = slugify(topic);
  if (!target) return [];
  const out: RunStories[] = [];
  for (const run of runs) {
    const articles = run.articles.filter((a) =>
      slugMatches(target, slugify(a.interest)),
    );
    if (articles.length === 0) continue;
    out.push({
      runId: run.id,
      generatedAt: run.generatedAt,
      articles,
    });
  }
  return out;
}
