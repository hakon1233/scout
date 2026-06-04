"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState } from "@/components/ui";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
} from "@/lib/companion";
import {
  fetchInterestsFull,
  interestKey,
  mockDocMeta,
  SAMPLE_INTERESTS,
  type InterestDocMeta,
} from "@/lib/interest-docs";
import { loadSettings } from "@/lib/storage";
import type { Interest } from "@/lib/types";

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

function mergeInterests(
  local: Interest[],
  companionTopics: string[],
): Interest[] {
  if (companionTopics.length === 0) return local;
  const byTopic = new Map(local.map((i) => [i.topic.trim().toLowerCase(), i]));
  return companionTopics.map((topic) => {
    const match = byTopic.get(topic.trim().toLowerCase());
    return match ?? { id: "", topic };
  });
}

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
    (async () => {
      const tok = await bootstrapCompanionToken();
      if (cancelled) return;
      const full = await fetchInterestsFull(tok);
      if (cancelled) return;
      if (full && full.interests.length > 0) {
        setInterests(full.interests);
        setDocMeta(full.meta);
        return;
      }
      const topics = await fetchCompanionInterests();
      if (cancelled) return;
      if (topics.length > 0) {
        setInterests((prev) => mergeInterests(prev, topics));
      }
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
        <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
          <a
            href="/app/profile"
            className="transition-colors hover:text-primary"
          >
            ← Profile
          </a>
          <div className="flex items-center gap-3">
            <span>Interest scope</span>
            <ThemeToggle />
          </div>
        </div>

        {!hydrated ? (
          <ScopeSkeleton />
        ) : !model ? (
          <EmptyState
            title="Interest not found"
            body="Return to your profile and open an interest from the list."
          />
        ) : (
          <>
            <header className="border-b border-border-default pb-5">
              <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
                <span className="h-[1.5px] w-[26px] bg-signal" />
                Research scope
              </p>
              <h1 className="font-serif text-[36px] font-semibold leading-[1.08] tracking-[-0.02em]">
                {model.interest.topic}
              </h1>
              {model.meta.updatedAt && (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  Intent doc updated {formatDocDate(model.meta.updatedAt)}
                </p>
              )}
            </header>

            <section className="max-w-3xl">
              {model.meta.body ? (
                <div className="scout-md">
                  <ReactMarkdown components={MD}>
                    {model.meta.body}
                  </ReactMarkdown>
                </div>
              ) : model.meta.hasDoc ? (
                <p className="font-reading text-[16px] leading-relaxed text-secondary">
                  Scout has an intent doc for this interest, but the companion
                  did not return its markdown in this session.
                </p>
              ) : (
                <EmptyState
                  title="No intent doc yet"
                  body="Refine this interest in the profile chat to create the research scope Scout will follow."
                />
              )}
            </section>

            <div className="flex flex-wrap gap-3 border-t border-border-default pt-5">
              <a
                href="/app/profile"
                className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Refine in profile chat
              </a>
              <a
                href="/app"
                className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
