// A Scout share link pasted into Browse's search box. Slugs are 32 hex
// characters (new_share_slug in the database). Accepted forms:
//   https://<host>/<base>/i/?s=<slug>   (what shareUrl makes)
//   <host>/i/<slug>                     (with or without a scheme)
//   <slug>                              (bare)
// Anything else is a search, so this returns null for it.

const SLUG = /^[0-9a-f]{32}$/i;

export function parseShareLink(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (SLUG.test(text)) return text.toLowerCase();
  if (!text.includes("/")) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
  } catch {
    return null;
  }
  const path = /\/i\/(?:([^/]+)\/?)?$/.exec(url.pathname);
  if (!path) return null;
  const slug = path[1] ?? url.searchParams.get("s");
  return slug && SLUG.test(slug) ? slug.toLowerCase() : null;
}
