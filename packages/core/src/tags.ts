// Topic tags (plan/research/browse.md). A public topic has 1 to 5 tags: lower
// case letters, digits and dashes, 2 to 24 long. The publish check prefers the
// seed list below and adds at most one free tag. The database's tags_ok and
// normalize_tags enforce the same rule.

/** The fixed seed vocabulary: browse's tag chips and the publish check's first choice. */
export const SEED_TAGS = [
  "ai",
  "tech",
  "science",
  "climate",
  "energy",
  "health",
  "business",
  "startups",
  "finance",
  "markets",
  "crypto",
  "politics",
  "norway",
  "europe",
  "world",
  "security",
  "law",
  "education",
  "jobs",
  "sports",
  "football",
  "culture",
  "music",
  "film",
  "books",
  "gaming",
  "food",
  "travel",
  "local",
  "research",
  // Specific tags the Scout team's catalog uses (supabase/seeds/team-topics.sql),
  // so the publish check can pick them over a broad one.
  "smart-home",
  "open-source",
  "self-hosting",
  "dev-tools",
  "hardware",
  "outdoors",
  "events",
  "regulation",
] as const;

export const MAX_TAGS = 5;
export const TAG_PATTERN = /^[a-z0-9æøå-]{2,24}$/;

const SEED = new Set<string>(SEED_TAGS);

export function isSeedTag(tag: string): boolean {
  return SEED.has(tag);
}

/**
 * Trims and lower-cases, drops empties, repeats and anything not a tag, and
 * keeps the first `MAX_TAGS`. With `maxFree`, keeps at most that many tags
 * outside the seed list (the first ones).
 */
export function normalizeTags(
  tags: readonly unknown[],
  opts: { maxFree?: number } = {},
): string[] {
  const out: string[] = [];
  let free = 0;
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (!TAG_PATTERN.test(tag) || out.includes(tag)) continue;
    if (!SEED.has(tag)) {
      if (opts.maxFree !== undefined && free >= opts.maxFree) continue;
      free++;
    }
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}
