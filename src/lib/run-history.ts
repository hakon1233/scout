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

// Exact-then-fuzzy slug equality, matching BriefView's join so an article whose
// `interest` the model capitalized/pluralized slightly differently still lands
// under the right card.
function slugMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

// Dedupe the available briefs by id and order them newest-run-first. Nullish
// entries (no cached brief yet) are dropped.
export function orderedRuns(
  briefs: ReadonlyArray<Brief | null | undefined>,
): Brief[] {
  const seen = new Set<string>();
  const out: Brief[] = [];
  for (const b of briefs) {
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out.sort((x, y) => {
    const tx = Date.parse(x.generatedAt);
    const ty = Date.parse(y.generatedAt);
    // Unparseable dates sort last but keep a stable order otherwise.
    if (Number.isNaN(tx) && Number.isNaN(ty)) return 0;
    if (Number.isNaN(tx)) return 1;
    if (Number.isNaN(ty)) return -1;
    return ty - tx;
  });
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
