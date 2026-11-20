"use client";

import Link from "next/link";
import {
  AppShell,
  PageHeader,
  newTopicHref,
} from "@/components/shell/AppShell";
import { NoticeCard } from "@/components/ui";

// Placeholder until public topics can be listed; a later job fills it.
// Each result will carry the same PushBell as a topic card.
export default function BrowsePage() {
  return (
    <AppShell>
      <PageHeader title="Browse" back={{ href: "/app/", label: "Brief" }}>
        Public topics from other readers and the Scout team.
      </PageHeader>
      <div data-main>
        <NoticeCard label="Coming soon" tone="neutral">
          Public topics show here soon. Until then, follow one from a link
          someone shares, or{" "}
          <Link href={newTopicHref()} className="font-medium underline">
            start your own
          </Link>
          .
        </NoticeCard>
      </div>
    </AppShell>
  );
}
