"use client";

import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { ChatDock } from "@/components/profile/ChatDock";
import { InterestDocCard } from "@/components/profile/InterestDocCard";
import { useProfileWorkbench } from "@/components/profile/useProfileWorkbench";

// Claude-Code–style interest chat (PER-228). Desktop ≥1024px: a centered chat
// reading column beside a docs rail (1px divider). Below 1024px: a single chat
// column with a Chat|Docs segmented toggle; on small screens Docs opens as a
// bottom-sheet so the founder can glance at the docs the conversation is moving.
export default function ChatPage() {
  const workbench = useProfileWorkbench();
  const [tab, setTab] = useState<"chat" | "docs">("chat");

  const rail = (
    <DocsRail
      workbench={workbench}
      onAfterFocus={() => setTab("chat")}
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

      {/* Segmented Chat|Docs toggle — below the two-pane breakpoint only. */}
      <div className="shrink-0 px-4 py-2 sm:px-6 lg:hidden">
        <div className="mx-auto flex w-full max-w-[720px] rounded-pill border border-border-default bg-surface-muted p-[3px]">
          <SegButton on={tab === "chat"} onClick={() => setTab("chat")}>
            Chat
          </SegButton>
          <SegButton on={tab === "docs"} onClick={() => setTab("docs")}>
            Docs
            {workbench.docCount > 0 ? (
              <span className="ml-1.5 text-signal">{workbench.docCount}</span>
            ) : null}
          </SegButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Chat pane. On tablet (md–lg) the toggle swaps panes inline; on mobile
            chat stays the base layer under the bottom-sheet. */}
        <div
          className={[
            "min-h-0 min-w-0 flex-1",
            tab === "docs" ? "hidden md:hidden lg:flex" : "flex",
          ].join(" ")}
        >
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
          />
        </div>

        {/* Tablet docs pane (768–1023px): inline single column. */}
        {tab === "docs" ? (
          <div className="hidden min-h-0 flex-1 overflow-y-auto md:block lg:hidden">
            {rail}
          </div>
        ) : null}

        {/* Desktop docs rail (≥1024px): ~38%, 1px divider. */}
        <aside className="hidden min-h-0 w-[38%] min-w-[380px] max-w-[480px] overflow-y-auto border-l border-border-default lg:block">
          {rail}
        </aside>
      </div>

      {/* Mobile docs bottom-sheet (<768px). */}
      {tab === "docs" ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Interest docs">
          <button
            type="button"
            aria-label="Close docs"
            onClick={() => setTab("chat")}
            className="absolute inset-0 bg-[rgba(28,26,23,0.28)]"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col overflow-hidden rounded-t-[18px] border-t border-border-default bg-surface">
            <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
              <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
                Interest docs · {workbench.docCount}
              </span>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className="font-mono text-[11px] uppercase tracking-[0.06em] text-secondary"
              >
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{rail}</div>
          </div>
        </div>
      ) : null}
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

function DocsRail({
  workbench,
  onAfterFocus,
}: {
  workbench: ReturnType<typeof useProfileWorkbench>;
  onAfterFocus: () => void;
}) {
  const { cards, focusKey, setFocusKey } = workbench;
  return (
    <div className="px-4 py-5 sm:px-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
          Interest docs
        </h2>
        <span className="font-mono text-[11px] text-muted">
          {cards.length} {cards.length === 1 ? "topic" : "topics"}
        </span>
      </div>
      {cards.length === 0 ? (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
