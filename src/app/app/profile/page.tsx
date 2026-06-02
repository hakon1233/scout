"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState } from "@/components/ui";
import { fetchCompanionInterests } from "@/lib/companion";
import {
  fetchInterestDocMeta,
  type InterestDocMeta,
  type InterestWithDoc,
  interestEditorHref,
  interestKey,
  mockDocMeta,
  SAMPLE_INTERESTS,
} from "@/lib/interest-docs";
import { loadSettings } from "@/lib/storage";
import type { Interest } from "@/lib/types";

// Merge the locally-stored interests (which carry stable ids) with whatever the
// companion reports it's actually running (topic-only — see PER-157 adoption).
// Companion order wins so the profile mirrors the wire the user will receive;
// ids are reused from local settings when the topic matches, else synthesized
// by interestKey. When not served from the companion we just show local.
function mergeInterests(
  local: Interest[],
  companionTopics: string[],
): Interest[] {
  if (companionTopics.length === 0) return local;
  const byTopic = new Map(
    local.map((i) => [i.topic.trim().toLowerCase(), i]),
  );
  return companionTopics.map((topic) => {
    const match = byTopic.get(topic.trim().toLowerCase());
    return match ?? { id: "", topic };
  });
}

function formatDocDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProfilePage() {
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [docMeta, setDocMeta] = useState<Record<string, InterestDocMeta>>({});
  // `?mock` / `?mock=full` seeds a synthetic doc shape so the indicator's two
  // states are reviewable before C1 lands. null in production.
  const [mockSeed, setMockSeed] = useState<string | null>(null);

  // Hydrate from localStorage on mount — static export renders at build time
  // with no window, so this is the canonical sync point (mirrors app/page.tsx).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seed = params.has("mock") ? params.get("mock") || "alt" : null;
    const stored = loadSettings();
    const localInterests =
      stored?.interests && stored.interests.length > 0
        ? stored.interests
        : seed !== null
          ? SAMPLE_INTERESTS
          : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(stored?.name?.trim() ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInterests(localInterests);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMockSeed(seed);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  // After hydration, reconcile with the companion's live interest set (when
  // served from it) and load real doc metadata. Mock seed short-circuits both.
  useEffect(() => {
    if (!hydrated) return;
    if (mockSeed !== null) return;
    let cancelled = false;
    (async () => {
      const [companionTopics, meta] = await Promise.all([
        fetchCompanionInterests(),
        fetchInterestDocMeta(),
      ]);
      if (cancelled) return;
      if (companionTopics.length > 0) {
        setInterests((prev) => mergeInterests(prev, companionTopics));
      }
      setDocMeta(meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, mockSeed]);

  const rows: InterestWithDoc[] = useMemo(() => {
    const meta =
      mockSeed !== null ? mockDocMeta(interests, mockSeed) : docMeta;
    return interests.map((i) => ({
      ...i,
      doc: meta[interestKey(i)] ?? { hasDoc: false },
    }));
  }, [interests, docMeta, mockSeed]);

  const docCount = rows.filter((r) => r.doc.hasDoc).length;

  return (
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-2xl space-y-8 px-5 py-10">
        {/* Top bar — mirrors /app/connect */}
        <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
          <a href="/app" className="transition-colors hover:text-primary">
            ← Scout
          </a>
          <div className="flex items-center gap-3">
            <span>Your profile</span>
            <ThemeToggle />
          </div>
        </div>

        {/* Masthead */}
        <header>
          <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
            <span className="h-[1.5px] w-[26px] bg-signal" />
            Your wire
          </p>
          <h1 className="mb-2 font-serif text-[34px] font-semibold tracking-[-0.02em] leading-[1.1]">
            {hydrated && name ? name : "Your profile"}
          </h1>
          <p className="font-reading text-[17px] leading-relaxed text-secondary">
            The interests Scout files briefs against. Give any one an{" "}
            <span className="text-primary">intent doc</span> to steer what its
            research session looks for.
          </p>
        </header>

        {/* Interests section */}
        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-border-default pb-2">
            <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
              Interests
            </h2>
            {hydrated && rows.length > 0 && (
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                {docCount} of {rows.length} with intent doc
              </p>
            )}
          </div>

          {!hydrated ? (
            <ProfileSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No interests yet"
              body="Set the topics you want briefed, then come back to give each one an intent doc."
              primary={{
                label: "Set your interests",
                onClick: () => {
                  window.location.href = "/app";
                },
              }}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((row) => (
                <li key={interestKey(row)}>
                  <InterestRow row={row} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function InterestRow({ row }: { row: InterestWithDoc }) {
  const { hasDoc, updatedAt } = row.doc;
  return (
    <a
      href={interestEditorHref(row)}
      className="group flex items-center gap-4 rounded-md border border-border-default bg-surface px-4 py-3.5 no-underline transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-[18px] font-medium leading-snug text-primary">
          {row.topic}
        </p>
        <div className="mt-1">
          <DocIndicator hasDoc={hasDoc} updatedAt={updatedAt} />
        </div>
      </div>
      <span
        aria-hidden="true"
        className="font-mono text-[13px] text-muted transition-colors group-hover:text-signal"
      >
        {hasDoc ? "Edit →" : "Add →"}
      </span>
    </a>
  );
}

// The "has intent doc" indicator. Two honest states — a signal-dot + dateline
// when a doc exists, a muted dashed-dot "add" prompt when it doesn't.
function DocIndicator({
  hasDoc,
  updatedAt,
}: {
  hasDoc: boolean;
  updatedAt?: string;
}) {
  if (hasDoc) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-signal">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-signal"
        />
        Intent doc
        {updatedAt && (
          <span className="text-muted normal-case tracking-normal">
            · updated {formatDocDate(updatedAt)}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-border-strong"
      />
      No intent doc yet
    </span>
  );
}

function ProfileSkeleton() {
  return (
    <ul className="flex flex-col gap-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-md border border-border-default bg-surface px-4 py-3.5"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-surface-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
