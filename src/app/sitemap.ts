import type { MetadataRoute } from "next";
import { sitemapFile } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFile();
}
