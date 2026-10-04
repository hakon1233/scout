import type {
  Interest,
  TopicBasis,
  TopicCoverage,
} from "@scout/agent/contract";

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
  // The in-depth write-up shown ONLY in the click-through detail view (PER-214):
  // a few short, concise paragraphs (what happened, why it matters, key
  // specifics), distinct from the one-line `text` blurb the feed card shows.
  // Captured during research as an indented markdown blockquote (`> …`) under the
  // story's citation/image; paragraphs are separated by blank lines (`\n\n`).
  // Optional: a story with little to say degrades to just the blurb. Never
  // fabricated filler — grounded in the same sources as the rest of the item.
  body?: string;
};

export type Brief = {
  id: string;
  generatedAt: string;
  // True only for QA/dry-run output. It can be polled by its initiating caller
  // but is never eligible to become the user's current feed (PER-288).
  ephemeral?: boolean;
  kind?: "daily" | "weekly";
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
