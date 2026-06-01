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
};

export type Settings = {
  name: string;
  interests: Interest[];
};
