import type { Metadata } from "next";
import { pageRobots } from "@/lib/seo";

// The tab title for this screen ("Public topic · Scout"); the page is a client
// component, so its metadata lives here.
export const metadata: Metadata = {
  title: { default: "Public topic", template: "%s · Scout" },
  robots: pageRobots("/i/"),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
