// Thin Exa wrapper. The companion always uses the user's own Exa key — there is no
// shared proxy in the loopback architecture (no server). Inject a custom fetcher
// for tests.

export type ExaResult = {
  url: string;
  title?: string;
  text?: string;
  publishedDate?: string;
};

export type Fetcher = typeof fetch;

export async function exaSearch(
  query: string,
  apiKey: string,
  fetcher: Fetcher = fetch,
  numResults = 4,
): Promise<ExaResult[]> {
  const res = await fetcher("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      numResults,
      type: "neural",
      useAutoprompt: true,
      contents: { text: { maxCharacters: 1800 } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`exa search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: ExaResult[] };
  return json.results ?? [];
}
