"use client";

import { EmptyState } from "@/components/ui";
import { InterestDocCard } from "./InterestDocCard";
import { ProfileSkeleton } from "./ProfileSkeleton";
import type { useProfileWorkbench } from "./useProfileWorkbench";

type Workbench = ReturnType<typeof useProfileWorkbench>;

export function InterestsList({
  workbench,
  refineInChat = false,
}: {
  workbench: Workbench;
  refineInChat?: boolean;
}) {
  const { hydrated, cards, docCount, focusKey, setFocusKey } = workbench;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between border-b border-border-default pb-2">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
          Interests
        </h2>
        {hydrated && cards.length > 0 && (
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {docCount} of {cards.length} with intent doc
          </p>
        )}
      </div>

      {!hydrated ? (
        <ProfileSkeleton />
      ) : cards.length === 0 ? (
        <EmptyState
          title="No interests yet"
          body="Ask Scout to start tracking a topic. It will appear here with its intent doc."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((card) => (
            <li key={card.key}>
              <InterestDocCard
                model={card}
                focused={focusKey === card.key}
                onFocusToggle={() => {
                  if (refineInChat) {
                    window.location.assign(
                      `/app/chat?focus=${encodeURIComponent(card.key)}`,
                    );
                    return;
                  }
                  setFocusKey((cur) => (cur === card.key ? null : card.key));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
