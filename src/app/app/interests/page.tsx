"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { ChatDock } from "@/components/profile/ChatDock";
import { InterestDocCard } from "@/components/profile/InterestDocCard";
import { InterestScopeView } from "@/components/profile/InterestScopeView";
import { ProfileSkeleton } from "@/components/profile/ProfileSkeleton";
import { SkillSection } from "@/components/skills/SkillSection";
import { useProfileWorkbench } from "@/components/profile/useProfileWorkbench";
import { ARTICLE_ASSEMBLY_SKILLS, RESEARCH_SKILLS } from "@/lib/skills";

// The consolidated interest workbench (PER-228 → PER-233 flip): the LEFT pane
// is the BIG primary view — interest docs AND the Skills setup (the same
// engine-honest sections as /app/skills) — and the chat is a NARROW clamped
// column on the RIGHT (~360–420px, full height, composer pinned to its
// bottom), separated by the hairline divider. Below 1024px the page collapses
// to a single column with an "Interests & skills | Chat" segmented toggle that
// swaps the panes inline (chat is the default view).
export default function InterestsPage() {
  const workbench = useProfileWorkbench();
  const [tab, setTab] = useState<"chat" | "docs">("chat");

  // PER-236 fix 2: drilling into one interest doc swaps ONLY the left pane to
  // the scope view — the chat column stays mounted, so the live transcript,
  // streaming state, and focus survive the drill-in. URL carries `?id=` (the
  // companion serves only the `/app/` shell, so this is in-page state synced
  // to history, same pattern as FeedView's story detail).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const readId = () =>
      new URLSearchParams(window.location.search).get("id");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL → state hydration on mount
    setSelectedKey(readId());
    const onPop = () => setSelectedKey(readId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openDoc(key: string) {
    setSelectedKey(key);
    setTab("docs"); // on small screens the detail lives in the docs tab
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("id", key);
      window.history.pushState({ scoutInterestDoc: key }, "", url);
    } catch {
      // pushState can throw in rare sandboxed contexts — detail still opens.
    }
  }

  function closeDoc() {
    const state = window.history.state as
      | { scoutInterestDoc?: string }
      | null;
    if (state?.scoutInterestDoc) {
      window.history.back(); // pops our entry → popstate clears the selection
    } else {
      setSelectedKey(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("id");
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* selection already cleared */
      }
    }
  }

  const primary = (
    <PrimaryPane
      workbench={workbench}
      onAfterFocus={() => setTab("chat")}
      selectedKey={selectedKey}
      onOpenDoc={openDoc}
      onCloseDoc={closeDoc}
    />
  );

  const chat = (
    <ChatDock
      messages={workbench.messages}
      sending={workbench.sending}
      error={workbench.error}
      focusTopic={workbench.focusTopic}
      streamId={workbench.streamId}
      streamLen={workbench.streamLen}
      onClearFocus={() => workbench.setFocusKey(null)}
      onSend={workbench.send}
      onStop={workbench.stop}
      onRetry={workbench.retry}
      onUndo={workbench.undo}
      onConfirmDelete={workbench.confirmDelete}
      onCancelDelete={workbench.cancelDelete}
      onConfirmRewrite={workbench.confirmRewrite}
      onDiscardRewrite={workbench.discardRewrite}
    />
  );

  return (
    <main
      className="flex flex-col bg-page text-primary"
      style={{ height: "100svh" }}
    >
      <header className="shrink-0 border-b border-border-default px-4 py-3 sm:px-6">
        <AppNav />
      </header>

      {/* Segmented toggle — below the two-pane breakpoint only. Reaches BOTH
          the big interests+skills view and the chat. */}
      <div className="shrink-0 px-4 py-2 sm:px-6 lg:hidden">
        <div className="mx-auto flex w-full max-w-[720px] rounded-pill border border-border-default bg-surface-muted p-[3px]">
          <SegButton on={tab === "docs"} onClick={() => setTab("docs")}>
            Interests &amp; skills
            {workbench.docCount > 0 ? (
              <span className="ml-1.5 text-signal">{workbench.docCount}</span>
            ) : null}
          </SegButton>
          <SegButton on={tab === "chat"} onClick={() => setTab("chat")}>
            Chat
          </SegButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* BIG primary pane (≥1024px): interests + skills setup fill the
            majority of the width on the LEFT. Below lg it swaps inline with
            the chat via the toggle. */}
        <div
          className={[
            "min-h-0 min-w-0 flex-1 overflow-y-auto lg:block",
            tab === "docs" ? "block" : "hidden",
          ].join(" ")}
        >
          {primary}
        </div>

        {/* NARROW chat pane (≥1024px): clamped sidebar-style column on the
            RIGHT, full height, hairline divider; ChatDock pins its own
            composer to the pane bottom. Below lg it is the default full-width
            view. */}
        <aside
          className={[
            "min-h-0 min-w-0 flex-1 lg:w-[30%] lg:min-w-[360px] lg:max-w-[420px] lg:flex-none lg:border-l lg:border-border-default",
            tab === "chat" ? "flex" : "hidden lg:flex",
          ].join(" ")}
        >
          {chat}
        </aside>
      </div>
    </main>
  );
}

function SegButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={[
        "flex-1 rounded-pill py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        on ? "bg-surface text-primary shadow-sm" : "text-muted",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// The big left pane: the interest docs (cards + raw view) followed by the
// Skills setup — the same engine-honest skill sections as /app/skills,
// surfaced here so interests and skills are configured in one place.
function PrimaryPane({
  workbench,
  onAfterFocus,
  selectedKey,
  onOpenDoc,
  onCloseDoc,
}: {
  workbench: ReturnType<typeof useProfileWorkbench>;
  onAfterFocus: () => void;
  selectedKey: string | null;
  onOpenDoc: (key: string) => void;
  onCloseDoc: () => void;
}) {
  const { hydrated, cards, docCount, focusKey, setFocusKey } = workbench;

  // Single-doc drill-in (PER-236 fix 2): the scope view replaces the card
  // list + skills in THIS pane only; the chat aside is untouched. Wait for
  // hydration before declaring an id "not found".
  if (selectedKey !== null) {
    if (!hydrated) {
      return (
        <div className="mx-auto w-full max-w-[880px] px-4 py-6 sm:px-6 lg:py-8">
          <ProfileSkeleton />
        </div>
      );
    }
    const selected = cards.find((c) => c.key === selectedKey) ?? null;
    return (
      <div className="mx-auto w-full max-w-[880px] px-4 py-6 sm:px-6 lg:py-8">
        <InterestScopeView
          model={selected}
          onBack={onCloseDoc}
          onRefine={
            selected
              ? () => {
                  setFocusKey(selected.key);
                  onAfterFocus();
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 px-4 py-6 sm:px-6 lg:py-8">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
            Interests
          </h2>
          {hydrated && cards.length > 0 ? (
            <span className="font-mono text-[11px] text-muted">
              {docCount} of {cards.length} with intent doc
            </span>
          ) : null}
        </div>
        {!hydrated ? (
          <ProfileSkeleton />
        ) : cards.length === 0 ? (
          <p className="font-reading text-[15px] leading-relaxed text-muted">
            No interests yet. Tell Scout what to track and your docs will appear
            here as it drafts them.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {cards.map((c) => (
              <InterestDocCard
                key={c.key}
                model={c}
                focused={focusKey === c.key}
                onFocusToggle={() => {
                  setFocusKey(focusKey === c.key ? null : c.key);
                  onAfterFocus();
                }}
                onOpen={() => onOpenDoc(c.key)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-6 border-t border-border-default pt-8">
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
            Skills setup
          </h2>
          <p className="max-w-prose text-body-sm text-secondary">
            The general skills Scout applies to every brief — how it researches
            the news and how it assembles what it finds. They govern how news is
            found and presented, while your interests decide what Scout looks
            for.
          </p>
        </div>
        <SkillSection set={RESEARCH_SKILLS} />
        <SkillSection set={ARTICLE_ASSEMBLY_SKILLS} />
      </section>
    </div>
  );
}
