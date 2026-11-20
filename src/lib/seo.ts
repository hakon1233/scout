import type { Metadata, MetadataRoute } from "next";

// Search indexing, decided here only. The marketing plan (docs/MARKETING.md):
// search engines index a few hand-picked pages and every other page is noindex,
// because a pile of AI-written pages can get the whole site penalised.
//
// The one switch is SCOUT_INDEXED_SITE, set at build time to the real site's
// root URL (with its base path). Unset, every page is noindex: the test site
// (`pnpm deploy:ideas` clears it), previews, the demo and local builds.

/** The pages search engines may index on the real site. */
export const INDEXED_PAGES = ["/", "/app/browse/", "/i/"] as const;
export type IndexedPage = (typeof INDEXED_PAGES)[number];

type Env = Record<string, string | undefined>;

/** The real site's root URL, or null when this build is not the real site. */
export function indexedSite(env: Env = process.env): string | null {
  const raw = env.SCOUT_INDEXED_SITE;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SCOUT_INDEXED_SITE must be the site's https URL: ${raw}`);
  }
  if (url.protocol !== "https:")
    throw new Error(`SCOUT_INDEXED_SITE must be the site's https URL: ${raw}`);
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * A page's robots meta: index only for a hand-picked page on the real site.
 * The root layout passes null (every other page); the indexed pages' own
 * layouts pass their path.
 */
export function pageRobots(
  page: IndexedPage | null,
  env: Env = process.env,
): NonNullable<Metadata["robots"]> {
  const index = page !== null && indexedSite(env) !== null;
  return { index, follow: index };
}

/**
 * A public topic page (`/i/`) is indexed only for a public Scout team topic;
 * the page adds noindex on the client for any other.
 */
export function topicIndexable(t: { visibility: string; team: boolean }) {
  return t.visibility === "public" && t.team;
}

// Crawlers may read every page, so they see each page's noindex (a robots.txt
// block would hide it and leave bare links indexable).
export function robotsFile(env: Env = process.env): MetadataRoute.Robots {
  const site = indexedSite(env);
  const rules = { userAgent: "*", allow: "/" };
  return site ? { rules, sitemap: `${site}sitemap.xml` } : { rules };
}

// Topic pages are `/i/?s=<slug>`, read on the client, so the static sitemap
// lists only the fixed pages.
export function sitemapFile(env: Env = process.env): MetadataRoute.Sitemap {
  const site = indexedSite(env);
  if (!site) return [];
  return ["", "app/browse/"].map((path) => ({ url: `${site}${path}` }));
}
