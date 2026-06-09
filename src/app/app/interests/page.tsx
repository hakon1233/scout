"use client";

import Link from "next/link";
import { InterestsList } from "@/components/profile/InterestsList";
import { ProfilePageShell } from "@/components/profile/ProfilePageShell";
import { useProfileWorkbench } from "@/components/profile/useProfileWorkbench";

export default function InterestsPage() {
  const workbench = useProfileWorkbench();

  return (
    <ProfilePageShell
      eyebrow="Interests"
      title={
        workbench.hydrated && workbench.name ? workbench.name : "Interests"
      }
      description={
        <>
          The interests Scout files briefs against. Open any interest to inspect
          the research scope and rules behind that topic.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-start">
        <InterestsList workbench={workbench} refineInChat />
        {/* The full chat + docs workbench lives on /app/chat (PER-228). From the
            interests list we just point there rather than embedding a second,
            cramped copy of the conversation surface. */}
        <aside className="rounded-lg border border-border-default bg-surface p-4">
          <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Manage with chat
          </h2>
          <p className="mt-2 font-reading text-[15px] leading-relaxed text-secondary">
            Use Scout&apos;s chat when you want to add a new topic, tighten an
            intent doc, or remove something you no longer care about.
          </p>
          <Link
            href="/app/chat"
            className="mt-4 inline-flex rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Open chat
          </Link>
        </aside>
      </div>
    </ProfilePageShell>
  );
}
