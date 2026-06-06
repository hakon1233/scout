export type Interest = { id: string; topic: string };

export type Article = {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  publishedAt?: string;
  author?: string;
  source?: string;
  text?: string;
  interest: string;
  // One representative image handpicked FROM THE NEWS SOURCE itself (the article's
  // own lead image — og:image / twitter:image / first meaningful inline <img>),
  // captured during research as an `![source image](url)` line under the citation
  // (PER-211). Optional: missing/blocked/paywalled images degrade to a text-only
  // card. Never a stock/generated/placeholder image.
  imageUrl?: string;
  // Optional extra images for the detail view. Reserved for future multi-image
  // stories; the feed card uses `imageUrl`. May be empty/absent.
  images?: string[];
};

// Per-topic coverage status the companion computes authoritatively over the
// FULL requested-interest list (PER-154). Mirrors the agent's TopicCoverage.
//   - "covered": real content with at least one citation.
//   - "empty":   a section exists but the model found no fresh news today — an
//                honest "nothing", NOT an error, and NOT something Retry fixes.
//   - "missing": the model dropped/merged the topic entirely — the only state
//                that warrants an automatic focused retry.
export type TopicStatus = "covered" | "empty" | "missing";
export type TopicCoverage = { topic: string; status: TopicStatus };

// A snapshot of the intent doc that drove one topic's research, captured by the
// companion at synthesis time (PER-187). Lets the brief show the reader exactly
// what each section's research was based on — the doc text actually used for
// that run. Mirrors the agent's TopicBasis. `topic` matches the `## <topic>`
// heading in `markdown`.
export type TopicBasis = { topic: string; doc: string };

export type Brief = {
  id: string;
  generatedAt: string;
  interests: string[];
  articles: Article[];
  markdown: string;
  // Authoritative per-topic status from the companion. Preferred over the
  // legacy client-side heading parse. Present on briefs produced since PER-154.
  topics?: TopicCoverage[];
  // Legacy: topics the OLD UI guessed were absent by case-sensitively diffing
  // parsed headings against requested interests. Superseded by `topics`; kept
  // for briefs cached before PER-154. Derive from `topics` when available.
  failedTopics?: string[];
  // Per-topic snapshot of the intent doc each section's research was based on
  // (PER-187). Present on briefs produced since this change; absent on older
  // cached briefs (the UI then simply shows no "based on" affordance).
  bases?: TopicBasis[];
};

export type Settings = {
  name: string;
  interests: Interest[];
};
