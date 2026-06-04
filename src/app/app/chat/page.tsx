"use client";

import Link from "next/link";
import { ChatDock } from "@/components/profile/ChatDock";
import { ProfilePageShell } from "@/components/profile/ProfilePageShell";
import { useProfileWorkbench } from "@/components/profile/useProfileWorkbench";

export default function ChatPage() {
  const workbench = useProfileWorkbench();

  return (
    <ProfilePageShell
      eyebrow="Chat"
      title="Interest chat"
      description={
        <>
          Talk to Scout to add, refine, rename, or remove interests. Each
          confirmed change updates the interest docs Scout uses for research.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,560px)] lg:items-start">
        <aside className="rounded-lg border border-border-default bg-surface p-4">
          <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Current focus
          </h2>
          <p className="mt-2 font-reading text-[15px] leading-relaxed text-secondary">
            {workbench.focusTopic
              ? `Messages are aimed at ${workbench.focusTopic}.`
              : "Messages apply to all interests unless you open one from the Interests page."}
          </p>
          <Link
            href="/app/interests"
            className="mt-4 inline-flex rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Open interests
          </Link>
        </aside>

        <ChatDock
          messages={workbench.messages}
          sending={workbench.sending}
          error={workbench.error}
          focusTopic={workbench.focusTopic}
          onClearFocus={() => workbench.setFocusKey(null)}
          onSend={workbench.send}
        />
      </div>
    </ProfilePageShell>
  );
}
