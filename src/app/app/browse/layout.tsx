import type { Metadata } from "next";
import { pageRobots } from "@/lib/seo";

// The tab title for this screen ("Browse · Scout"); the page is a client
// component, so its metadata lives here.
export const metadata: Metadata = {
  title: { default: "Browse", template: "%s · Scout" },
  robots: pageRobots("/app/browse/"),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
