"use client";

import * as React from "react";
import type { BriefSettings } from "@scout/core";
import { BriefSettingsGroup } from "@/components/BriefSettingsGroup";
import { EmptyState } from "@/components/ui";
import {
  bootstrapCompanionToken,
  fetchInterestSettings,
  loadCompanionToken,
  updateInterestSettings,
} from "@/lib/companion";
import { LazyMarkdown } from "./LazyMarkdown";
import type { DocCardModel } from "./InterestDocCard";

// The topic's brief settings, read from and saved to the companion. Hidden
// when there is no paired companion (the `?mock` review pages) or it doesn't
// know the topic; a failed load says so in place.
function CompanionBriefSettings({ interestId }: { interestId: string }) {
  const [settings, setSettings] = React.useState<BriefSettings | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "none">(
    "loading",
  );
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    bootstrapCompanionToken()
      .then((token) =>
        token ? fetchInterestSettings(token, interestId) : null,
      )
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setState(s ? "ready" : "none");
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(
          err instanceof Error ? err.message : "Couldn't load the settings.",
        );
        setState("ready");
      });
    return () => {
      live = false;
    };
  }, [interestId]);

  const save = React.useCallback(
    (change: Partial<BriefSettings>) =>
      updateInterestSettings(loadCompanionToken(), interestId, change),
    [interestId],
  );

  if (state === "none") return null;
  if (loadError) {
    return (
      <p role="alert" className="text-body-sm text-danger">
        {loadError}
      </p>
    );
  }
  return (
    <div className="max-w-2xl">
      <BriefSettingsGroup settings={settings} save={save} />
    </div>
  );
}

// The single-interest "Research scope" detail rendered INSIDE
// the interests workbench's left pane, so the chat column on the right stays
// mounted (live transcript, streaming, focus state all preserved) while the
// reader drills into one doc. Mirrors the standalone
// /app/interests/interest page's editorial layout; that route remains for
// old deep links / new-tab opens.

const MD = {
  // The doc's own title sits under the page's h1 (the topic).
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-4 font-serif text-title-2 leading-tight text-primary"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-2 mt-7 text-body-sm font-medium text-secondary first:mt-0"
      {...p}
    />
  ),
  h3: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-5 font-serif text-title-3 text-primary" {...p} />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="my-3 font-reading text-body leading-relaxed text-secondary"
      {...p}
    />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-3 list-disc space-y-2 pl-6 font-reading text-body leading-relaxed text-secondary"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-3 list-decimal space-y-2 pl-6 font-reading text-body leading-relaxed text-secondary"
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
      className="rounded bg-surface-muted px-1 py-0.5 font-mono text-body-sm text-primary"
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
      <div className="text-body-sm font-medium text-muted">
        <button
          type="button"
          onClick={onBack}
          className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← Topics
        </button>
      </div>

      {!model ? (
        <EmptyState
          title="Topic not found"
          body="Return to Topics and open a topic from the list."
        />
      ) : (
        <>
          <header className="border-b border-border-default pb-5">
            <p className="mb-2 text-body-sm font-medium text-muted">
              Assignment
            </p>
            <h1 className="font-serif text-title-1">{model.topic}</h1>
            {model.updatedAt && (
              <p className="mt-2 text-body-sm text-muted">
                Assignment updated {formatDocDate(model.updatedAt)}
              </p>
            )}
          </header>

          <CompanionBriefSettings interestId={model.key} />

          <section className="max-w-3xl">
            {model.body ? (
              <div className="scout-md">
                <LazyMarkdown text={model.body} components={MD} />
              </div>
            ) : model.hasDoc ? (
              <p className="font-reading text-body leading-relaxed text-secondary">
                Scout has an assignment for this topic, but the companion did
                not return its markdown in this session.
              </p>
            ) : (
              <EmptyState
                title="No assignment yet"
                body="Refine this topic in chat to create the assignment Scout will follow."
              />
            )}
          </section>

          {onRefine ? (
            <div className="flex flex-wrap gap-3 border-t border-border-default pt-5">
              <button
                type="button"
                onClick={onRefine}
                className="rounded-pill border border-border-default px-3 py-2 text-caption font-medium text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
