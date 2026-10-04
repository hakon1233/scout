// Reading a brief: the markdown grammar the search skills ask the model for,
// turned into topics, stories and citations. Shared by the companion (weekly
// digest) and the web app (the feed), so it must stay browser-safe.
//
// The grammar, per section:
//
//   ## <topic>
//   - `YYYY-MM-DD` — one-sentence summary.        (or `undated`, or no marker)
//     [domain — Title](https://…)                  (one or more citations)
//     ![source image](https://…)                   (optional)
//     > Lead paragraph.                            (optional body)
//     >
//     > More paragraphs.
//
// A story runs from its bullet to the next bullet or heading. Editing a brief
// (sorting stories, dropping stale ones, merging retried sections) works on
// the raw text and lives in coverage.ts.

export type Citation = { label: string; url: string };

export type BriefEntry =
  | {
      kind: "story";
      // The heading the story sits under; null before the first heading.
      topic: string | null;
      // ISO date; null when the bullet says `undated` or has no date marker.
      date: string | null;
      // The bullet text as plain text, without the date marker.
      summary: string;
      // Citations in document order, from the bullet and continuation lines;
      // never images or links inside the body.
      links: Citation[];
      // The first source image, if any.
      image: string | null;
      // Blockquote paragraphs joined by blank lines.
      body: string | null;
      // The story's markdown, trimmed.
      raw: string;
    }
  | {
      // A citation outside any story, e.g. in a section's intro line.
      kind: "citation";
      topic: string | null;
      label: string;
      url: string;
    };

export type ParsedBrief = {
  // Section headings in order, each once.
  topics: string[];
  // Stories and loose citations in document order.
  entries: BriefEntry[];
};

// A URL inside a markdown `(…)`; one level of balanced parens is allowed so a
// CDN filename like `img%20(13).png` is not cut at its first `)`.
const MD_URL = "https?:\\/\\/(?:[^()\\s]|\\([^()\\s]*\\))+";
const LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\((${MD_URL})\\)`, "g");
const IMAGE_RE = new RegExp(`!\\[[^\\]]*\\]\\((${MD_URL})\\)`, "g");
const HEADING_RE = /^##\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[-*]\s+/;
const DATE_RE = /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`\s*(?:—|–|-)?\s*/;
const BODY_RE = /^\s*>\s?(.*)$/;

// Plain-text form of inline markdown, for summaries: images dropped, links
// unwrapped to their label, emphasis and code markers removed.
const STRIP_INNER = "(?:[^()]|\\([^()]*\\))*";
const STRIP_IMAGE_RE = new RegExp(`!\\[[^\\]]*\\]\\(${STRIP_INNER}\\)`, "g");
const STRIP_LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\(${STRIP_INNER}\\)`, "g");

function plainText(s: string): string {
  return s
    .replace(STRIP_IMAGE_RE, "")
    .replace(STRIP_LINK_RE, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type OpenStory = {
  topic: string | null;
  date: string | null;
  summary: string;
  links: Citation[];
  image: string | null;
  bodyLines: string[];
  lines: string[];
};

export function parseBrief(markdown: string): ParsedBrief {
  const topics: string[] = [];
  const entries: BriefEntry[] = [];
  let topic: string | null = null;
  let story: OpenStory | null = null;

  const close = () => {
    if (!story) return;
    const body = story.bodyLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    entries.push({
      kind: "story",
      topic: story.topic,
      date: story.date,
      summary: story.summary,
      links: story.links,
      image: story.image,
      body: body || null,
      raw: story.lines.join("\n").trim(),
    });
    story = null;
  };

  for (const line of markdown.split("\n")) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      close();
      topic = heading[1].trim();
      if (!topics.includes(topic)) topics.push(topic);
      continue;
    }

    if (BULLET_RE.test(line)) {
      close();
      const marker = DATE_RE.exec(line);
      story = {
        topic,
        date: marker && marker[1] !== "undated" ? marker[1] : null,
        summary: plainText(
          marker ? line.slice(marker[0].length) : line.replace(BULLET_RE, ""),
        ),
        links: [],
        image: null,
        bodyLines: [],
        lines: [],
      };
    }
    if (story) story.lines.push(line);

    // Body lines are prose: never scanned for citations or images.
    const bodyLine = BODY_RE.exec(line);
    if (bodyLine && story) {
      story.bodyLines.push(bodyLine[1]);
      continue;
    }

    for (const m of line.matchAll(IMAGE_RE)) {
      if (story && !story.image) story.image = m[1];
    }
    for (const m of line.matchAll(LINK_RE)) {
      // `![alt](url)` also matches as `[alt](url)`; images are not citations.
      if (m.index > 0 && line[m.index - 1] === "!") continue;
      const [, label, url] = m;
      if (story) story.links.push({ label, url });
      else entries.push({ kind: "citation", topic, label, url });
    }
  }
  close();
  return { topics, entries };
}

// One identity per story URL: the hash, query and trailing slash are dropped
// so tracking parameters and cosmetic variants collapse together.
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    const s = u.toString();
    return s.endsWith("/") ? s.slice(0, -1) : s;
  } catch {
    return url;
  }
}
