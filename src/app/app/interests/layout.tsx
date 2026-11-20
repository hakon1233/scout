import type { Metadata } from "next";

// The tab title for this screen ("Topics · Scout"); the page is a client
// component, so its metadata lives here.
export const metadata: Metadata = {
  title: { default: "Topics", template: "%s · Scout" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
