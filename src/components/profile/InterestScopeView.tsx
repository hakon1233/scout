"use client";

import { EmptyState } from "@/components/ui";
import { LazyMarkdown } from "./LazyMarkdown";
import type { DocCardModel } from "./InterestDocCard";

// PER-236 fix 2: the single-interest "Research scope" detail rendered INSIDE
// the interests workbench's left pane, so the chat column on the right stays
// mounted (live transcript, streaming, focus state all preserved) while the
// reader drills into one doc. Mirrors the standalone
// /app/interests/interest page's editorial layout; that route remains for
// old deep links / new-tab opens.

const MD = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1
      className="mb-4 font-serif text-[30px] font-semibold leading-tight text-primary"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-2 mt-7 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-secondary first:mt-0"
      {...p}
    />
  ),
  h3: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-5 font-serif text-[20px] text-primary" {...p} />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="my-3 font-reading text-[16px] leading-relaxed text-secondary"
      {...p}
    />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-3 list-disc space-y-2 pl-6 font-reading text-[16px] leading-relaxed text-secondary"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-3 list-decimal space-y-2 pl-6 font-reading text-[16px] leading-relaxed text-secondary"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-1" {...p} />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-primary" {...p} />
  ),
  a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-signal underline underline-offset-2" {...p} />
  ),
  code: (p: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[13px] text-primary"
      {...p}
    />
  ),
};

function formatDocDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function InterestScopeView({
  model,
  onBack,
  onRefine,
}: {
  // null when the ?id= didn't match a loaded interest.
  model: DocCardModel | null;
  onBack: () => void;
  // Focuses this interest in the adjacent chat (and surfaces the chat on
  // small screens) — replaces the standalone page's "Refine in chat" link.
  onRefine?: () => void;
}) {
  return (
    <div className="space-y-8">
      <div className="font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
        <button
          type="button"
          onClick={onBack}
          className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← Interests
        </button>
      </div>

      {!model ? (
        <EmptyState
          title="Interest not found"
          body="Return to Interests and open an interest from the list."
        />
      ) : (
        <>
          <header className="border-b border-border-default pb-5">
            <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
              <span className="h-[1.5px] w-[26px] bg-signal" />
              Assignment
            </p>
            <h1 className="font-serif text-[36px] font-semibold leading-[1.08] tracking-[-0.02em]">
              {model.topic}
            </h1>
            {model.updatedAt && (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Assignment updated {formatDocDate(model.updatedAt)}
              </p>
            )}
          </header>

          <section className="max-w-3xl">
            {model.body ? (
              <div className="scout-md">
                <LazyMarkdown text={model.body} components={MD} />
              </div>
            ) : model.hasDoc ? (
              <p className="font-reading text-[16px] leading-relaxed text-secondary">
                Scout has an assignment for this interest, but the companion
                did not return its markdown in this session.
              </p>
            ) : (
              <EmptyState
                title="No assignment yet"
                body="Refine this interest in chat to create the assignment Scout will follow."
              />
            )}
          </section>

          {onRefine ? (
            <div className="flex flex-wrap gap-3 border-t border-border-default pt-5">
              <button
                type="button"
                onClick={onRefine}
                className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Refine in chat
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
