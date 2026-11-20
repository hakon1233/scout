"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState } from "@/components/ui";
import { DOC_MARKDOWN } from "@/components/profile/DocMarkdown";
import { LazyMarkdown } from "@/components/profile/LazyMarkdown";
import { bootstrapCompanionToken } from "@/lib/companion";
import {
  fetchCompanionInterestSet,
  interestKey,
  mockDocMeta,
  SAMPLE_INTERESTS,
  type InterestDocMeta,
} from "@/lib/interest-docs";
import { formatDocDate } from "@/lib/format-date";
import { loadSettings } from "@/lib/storage";
import type { Interest } from "@scout/core";

export default function InterestScopePage() {
  const [hydrated, setHydrated] = useState(false);
  const [interestId, setInterestId] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [docMeta, setDocMeta] = useState<Record<string, InterestDocMeta>>({});
  const [mockSeed, setMockSeed] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seed = params.has("mock") ? params.get("mock") || "full" : null;
    const stored = loadSettings();
    const localInterests =
      stored?.interests && stored.interests.length > 0
        ? stored.interests
        : seed !== null
          ? SAMPLE_INTERESTS
          : [];
    /* eslint-disable react-hooks/set-state-in-effect */
    setInterestId(params.get("id") ?? "");
    setInterests(localInterests);
    setDocMeta(seed !== null ? mockDocMeta(localInterests, seed) : {});
    setMockSeed(seed);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated || mockSeed !== null) return;
    let cancelled = false;
    void (async () => {
      const tok = await bootstrapCompanionToken();
      if (cancelled) return;
      const set = await fetchCompanionInterestSet(
        tok,
        loadSettings()?.interests ?? [],
      );
      if (cancelled || !set) return;
      setInterests(set.interests);
      setDocMeta(set.meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, mockSeed]);

  const model = useMemo(() => {
    const interest = interests.find((i) => interestKey(i) === interestId);
    if (!interest) return null;
    const meta = docMeta[interestId] ?? { hasDoc: false };
    return { interest, meta };
  }, [interests, docMeta, interestId]);

  return (
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-4xl space-y-8 px-5 py-10">
        <div className="flex items-center justify-between text-body-sm font-medium text-muted">
          <a
            href="/app/interests"
            className="transition-colors hover:text-primary"
          >
            ← Topics
          </a>
          <div className="flex items-center gap-3">
            <span>Assignment</span>
            <ThemeToggle />
          </div>
        </div>

        {!hydrated ? (
          <ScopeSkeleton />
        ) : !model ? (
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
              <h1 className="font-serif text-title-1">
                {model.interest.topic}
              </h1>
              {model.meta.updatedAt && (
                <p className="mt-2 text-body-sm text-muted">
                  Assignment updated {formatDocDate(model.meta.updatedAt)}
                </p>
              )}
            </header>

            <section className="max-w-3xl">
              {model.meta.body ? (
                <div className="scout-md">
                  <LazyMarkdown
                    text={model.meta.body}
                    components={DOC_MARKDOWN}
                  />
                </div>
              ) : model.meta.hasDoc ? (
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

            <div className="flex flex-wrap gap-3 border-t border-border-default pt-5">
              <a
                href="/app/interests"
                className="rounded-pill border border-border-default px-3 py-2 text-caption font-medium text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Refine in chat
              </a>
              <a
                href="/app"
                className="rounded-pill border border-border-default px-3 py-2 text-caption font-medium text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Latest brief
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ScopeSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="h-9 w-2/3 animate-pulse rounded bg-surface-muted" />
      <div className="space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}
