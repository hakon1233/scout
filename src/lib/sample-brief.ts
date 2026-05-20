import type { Brief } from "./types";

export const SAMPLE_BRIEF: Brief = {
  id: "sample-brief",
  generatedAt: "2026-05-20T07:00:00.000Z",
  interests: ["AI agents", "Climate tech", "Norwegian football"],
  articles: [
    {
      id: "a1",
      title: "Anthropic ships a tighter agent framework focused on reliability",
      url: "https://www.theverge.com/2026/05/19/anthropic-agent-framework",
      source: "theverge.com",
      publishedAt: "2026-05-19T14:00:00.000Z",
      interest: "AI agents",
    },
    {
      id: "a2",
      title: "OpenAI rolls out browser-using agent into general preview",
      url: "https://www.bloomberg.com/news/articles/2026-05-18/openai-browser-agent",
      source: "bloomberg.com",
      publishedAt: "2026-05-18T09:30:00.000Z",
      interest: "AI agents",
    },
    {
      id: "a3",
      title: "Direct-air capture pilot claims sub-$200/ton operating cost",
      url: "https://www.technologyreview.com/2026/05/17/dac-cost-milestone",
      source: "technologyreview.com",
      publishedAt: "2026-05-17T11:15:00.000Z",
      interest: "Climate tech",
    },
    {
      id: "a4",
      title: "EU passes long-duration storage subsidy framework",
      url: "https://www.reuters.com/sustainability/eu-long-duration-storage-2026-05-16",
      source: "reuters.com",
      publishedAt: "2026-05-16T16:00:00.000Z",
      interest: "Climate tech",
    },
    {
      id: "a5",
      title: "Bodø/Glimt edge through to Europa League quarterfinals",
      url: "https://www.vg.no/sport/fotball/glimt-europa-league-2026-05-16",
      source: "vg.no",
      publishedAt: "2026-05-16T21:45:00.000Z",
      interest: "Norwegian football",
    },
    {
      id: "a6",
      title: "Eliteserien title race tightens after Molde upset",
      url: "https://www.nrk.no/sport/eliteserien-2026-05-19",
      source: "nrk.no",
      publishedAt: "2026-05-19T19:00:00.000Z",
      interest: "Norwegian football",
    },
  ],
  markdown: `## AI agents

- Anthropic shipped a tighter framework for tool-using agents focused on reliability — less prompt orchestration, more native tool use.
  [theverge.com — Anthropic ships a tighter agent framework focused on reliability](https://www.theverge.com/2026/05/19/anthropic-agent-framework)
- OpenAI rolled out its browser-using agent into general preview, opening the door to broader real-world tasks.
  [bloomberg.com — OpenAI rolls out browser-using agent into general preview](https://www.bloomberg.com/news/articles/2026-05-18/openai-browser-agent)

## Climate tech

- A direct-air capture pilot plant claimed sub-\$200/ton operating cost — down from \$600+ a year ago.
  [technologyreview.com — Direct-air capture pilot claims sub-\$200/ton operating cost](https://www.technologyreview.com/2026/05/17/dac-cost-milestone)
- The EU passed a long-duration storage subsidy framework, unlocking multi-day battery and thermal projects.
  [reuters.com — EU passes long-duration storage subsidy framework](https://www.reuters.com/sustainability/eu-long-duration-storage-2026-05-16)

## Norwegian football

- Bodø/Glimt edged through to the Europa League quarterfinals on aggregate — a second Norwegian club this deep is new territory.
  [vg.no — Bodø/Glimt edge through to Europa League quarterfinals](https://www.vg.no/sport/fotball/glimt-europa-league-2026-05-16)
- The Eliteserien title race tightened after Molde dropped points to a mid-table side.
  [nrk.no — Eliteserien title race tightens after Molde upset](https://www.nrk.no/sport/eliteserien-2026-05-19)
`,
};
