import type { Metadata } from "next";

// The tab title for this screen ("Browse · Scout"); the page is a client
// component, so its metadata lives here.
export const metadata: Metadata = {
  title: { default: "Browse", template: "%s · Scout" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
