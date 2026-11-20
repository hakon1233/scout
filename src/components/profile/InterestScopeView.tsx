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
import { formatDocDate } from "@/lib/format-date";
import { DOC_MARKDOWN } from "./DocMarkdown";
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
                <LazyMarkdown text={model.body} components={DOC_MARKDOWN} />
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
