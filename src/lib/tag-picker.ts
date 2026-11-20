import { MAX_TAGS, SEED_TAGS, TAG_PATTERN, isSeedTag } from "@scout/core";

// The tag picker's rules, shared by a public topic's tags (at most 5), the
// profile's liked tags (at most 10) and Browse's tag chips. Tags are lower
// case letters, digits and dashes, 2 to 24 long (TAG_PATTERN).

export type TagCount = { tag: string; topics: number };

/** A free tag joins the chip rows once this many public topics use it. */
export const FREE_TAG_MIN_TOPICS = 3;

/** Lower case and trimmed; null when it is not a tag. */
export function cleanTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
  return TAG_PATTERN.test(tag) ? tag : null;
}

/**
 * The tags worth offering as chips, most used first: seed tags and free tags
 * used by at least FREE_TAG_MIN_TOPICS public topics, then the rest of the
 * seed list in its own order.
 */
export function popularTags(counts: readonly TagCount[], limit = 12): string[] {
  const out: string[] = [];
  const sorted = [...counts].sort((a, b) => b.topics - a.topics);
  for (const c of sorted) {
    if (out.length >= limit) return out;
    if (c.topics <= 0 || out.includes(c.tag)) continue;
    if (isSeedTag(c.tag) || c.topics >= FREE_TAG_MIN_TOPICS) out.push(c.tag);
  }
  for (const tag of SEED_TAGS) {
    if (out.length >= limit) break;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Tags matching a search, for the picker's "+ tag" chips: known tags (the
 * seed list and the catalog's) that start with the query, then ones that
 * contain it, leaving out those already picked. `free` is the query itself
 * when it is a valid tag nobody has used yet.
 */
export function searchTags(
  query: string,
  opts: {
    selected: readonly string[];
    counts: readonly TagCount[];
    limit?: number;
  },
): { matches: string[]; free: string | null } {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return { matches: [], free: null };
  const known = [
    ...[...opts.counts].sort((a, b) => b.topics - a.topics).map((c) => c.tag),
    ...SEED_TAGS,
  ].filter((t, i, all) => all.indexOf(t) === i);
  const open = known.filter((t) => !opts.selected.includes(t));
  const starts = open.filter((t) => t.startsWith(q));
  const contains = open.filter((t) => !t.startsWith(q) && t.includes(q));
  const matches = [...starts, ...contains].slice(0, opts.limit ?? 6);
  const own = cleanTag(q);
  const free =
    own && !known.includes(own) && !opts.selected.includes(own) ? own : null;
  return { matches, free };
}

/** Adds the tag, or removes it when picked. A full picker adds nothing. */
export function toggleTag(
  selected: readonly string[],
  raw: string,
  max: number = MAX_TAGS,
): string[] {
  const tag = cleanTag(raw);
  if (!tag) return [...selected];
  if (selected.includes(tag)) return selected.filter((t) => t !== tag);
  if (selected.length >= max) return [...selected];
  return [...selected, tag];
}
