"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleSettings } from "@/components/ScheduleSettings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState } from "@/components/ui";
import {
  InterestDocCard,
  type DocBeat,
  type DocCardModel,
} from "@/components/profile/InterestDocCard";
import { ChatDock, type ChatMessage } from "@/components/profile/ChatDock";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
} from "@/lib/companion";
import { runChatTurn, type ChatChange } from "@/lib/chat";
import {
  fetchInterestsFull,
  type InterestDocMeta,
  interestKey,
  mockDocMeta,
  SAMPLE_INTERESTS,
} from "@/lib/interest-docs";
import { loadLastBrief, loadPrevBrief, loadSettings } from "@/lib/storage";
import { orderedRuns, runHistoryForTopic } from "@/lib/run-history";
import type { Brief, Interest } from "@/lib/types";

// Merge the locally-stored interests (which carry stable ids) with whatever the
// companion reports it's actually running (topic-only — see PER-157 adoption).
// Used only as a fallback when the authed full fetch is unavailable.
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

// Monotonic id for transcript lines (no Math.random — keeps a clean, testable
// sequence within a session).
let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export default function ProfilePage() {
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  // The brief editions cached in the browser (latest + previous), newest run
  // first — the source for each card's "news found per run" (PER-191 AC2).
  const [runs, setRuns] = useState<Brief[]>([]);
  const [docMeta, setDocMeta] = useState<Record<string, InterestDocMeta>>({});
  // Doc bodies known THIS session — only what a chat turn's `changes[]` actually
  // returned. There is no GET-doc-body route by design; we render confirmed
  // writes, never a guess.
  const [docBodies, setDocBodies] = useState<Record<string, string>>({});
  // Transient "just changed" beats, keyed by interestKey. The PER-139 proof.
  const [beats, setBeats] = useState<Record<string, DocBeat>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `?mock` / `?mock=full` seeds a synthetic doc shape so the card states are
  // reviewable before the companion is reachable. null in production.
  const [mockSeed, setMockSeed] = useState<string | null>(null);

  const beatTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(stored?.name?.trim() ?? "");
    setInterests(localInterests);
    setRuns(orderedRuns([loadLastBrief(), loadPrevBrief()]));
    setMockSeed(seed);
    setMessages([
      {
        id: nextMsgId(),
        role: "scout",
        text: "Hi — I'm Scout. Tell me what to track and I'll draft an intent doc for it, refine one you already have, or drop an interest. Pick “Refine” on any card to aim a message at it.",
      },
    ]);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // After hydration, bootstrap the pairing token and reconcile with the live
  // interest set (real ids + doc metadata in one authed round-trip). Mock seed
  // short-circuits the network entirely.
  useEffect(() => {
    if (!hydrated) return;
    if (mockSeed !== null) return;
    let cancelled = false;
    (async () => {
      const tok = await bootstrapCompanionToken();
      if (cancelled) return;
      setToken(tok);
      const full = await fetchInterestsFull(tok);
      if (cancelled) return;
      if (full && full.interests.length > 0) {
        setInterests(full.interests);
        setDocMeta(full.meta);
        return;
      }
      // Fallback: companion reachable but no authed list — mirror topics.
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

  // Clear any pending beat timers on unmount.
  useEffect(() => {
    const timers = beatTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  // Fire a "just changed" beat on a confirmed write, auto-reverting to the
  // static dateline after a beat so the card settles.
  const flashBeat = useCallback((key: string, kind: Exclude<DocBeat, null>) => {
    setBeats((prev) => ({ ...prev, [key]: kind }));
    if (beatTimers.current[key]) clearTimeout(beatTimers.current[key]);
    beatTimers.current[key] = setTimeout(() => {
      setBeats((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete beatTimers.current[key];
    }, 6000);
  }, []);

  // Apply one turn's confirmed change set to the cards. `interestId` is the
  // concrete server id, which is exactly a real interest's interestKey.
  const applyChanges = useCallback(
    (changes: ChatChange[], at: string) => {
      for (const ch of changes) {
        const key = ch.interestId;
        if (!key) continue;
        if (ch.op === "delete") {
          setInterests((prev) =>
            prev.filter((i) => interestKey(i) !== key && i.id !== key),
          );
          setDocBodies((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setDocMeta((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setFocusKey((cur) => (cur === key ? null : cur));
          if (beatTimers.current[key]) {
            clearTimeout(beatTimers.current[key]);
            delete beatTimers.current[key];
          }
          continue;
        }
        // create | update
        const topic = ch.topic?.trim() ?? "";
        setInterests((prev) => {
          const idx = prev.findIndex(
            (i) => interestKey(i) === key || i.id === key,
          );
          if (idx === -1) {
            return [...prev, { id: key, topic }];
          }
          if (topic && prev[idx].topic !== topic) {
            const next = [...prev];
            next[idx] = { ...next[idx], id: prev[idx].id || key, topic };
            return next;
          }
          return prev;
        });
        if (typeof ch.doc === "string") {
          setDocBodies((prev) => ({ ...prev, [key]: ch.doc as string }));
        }
        setDocMeta((prev) => ({
          ...prev,
          [key]: { hasDoc: true, updatedAt: at },
        }));
        flashBeat(key, ch.op === "create" ? "created" : "updated");
      }
    },
    [flashBeat],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;

      // The focused interest's topic scopes the message in natural language —
      // the POST body is `{ message }` only, so targeting rides in the prose.
      const focusTopic = focusKey
        ? (interests.find((i) => interestKey(i) === focusKey)?.topic ?? null)
        : null;
      const wire = focusTopic
        ? `Regarding my interest "${focusTopic}": ${text}`
        : text;

      const at = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "you", text, ts: at },
      ]);
      setSending(true);
      setError(null);

      (async () => {
        try {
          const turn = await runChatTurn(wire, token);
          const replyAt = new Date().toISOString();
          if (turn.reply) {
            setMessages((prev) => [
              ...prev,
              { id: nextMsgId(), role: "scout", text: turn.reply!, ts: replyAt },
            ]);
          }
          if (turn.changes && turn.changes.length > 0) {
            applyChanges(turn.changes, replyAt);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        } finally {
          setSending(false);
        }
      })();
    },
    [sending, focusKey, interests, token, applyChanges],
  );

  // Build the card view-models from the live interest set + everything we know
  // about each doc. Mock seed overlays synthetic metadata for review.
  const cards: DocCardModel[] = useMemo(() => {
    const meta = mockSeed !== null ? mockDocMeta(interests, mockSeed) : docMeta;
    return interests.map((i) => {
      const key = interestKey(i);
      const m = meta[key] ?? { hasDoc: false };
      const body = docBodies[key];
      return {
        key,
        topic: i.topic,
        hasDoc: m.hasDoc || Boolean(body),
        updatedAt: m.updatedAt,
        body,
        beat: beats[key] ?? null,
        // Per-run stories for this interest (newest first). Suppressed under the
        // mock seed, which has no real run data.
        runs: mockSeed !== null ? [] : runHistoryForTopic(runs, i.topic),
      };
    });
  }, [interests, docMeta, docBodies, beats, mockSeed, runs]);

  const docCount = cards.filter((c) => c.hasDoc).length;
  const focusTopic = focusKey
    ? (cards.find((c) => c.key === focusKey)?.topic ?? null)
    : null;

  return (
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-6xl space-y-8 px-5 py-10">
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
        <header className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
            <span className="h-[1.5px] w-[26px] bg-signal" />
            Your wire
          </p>
          <h1 className="mb-2 font-serif text-[34px] font-semibold tracking-[-0.02em] leading-[1.1]">
            {hydrated && name ? name : "Your profile"}
          </h1>
          <p className="font-reading text-[17px] leading-relaxed text-secondary">
            The interests Scout files briefs against. Talk to Scout to give any
            one an <span className="text-primary">intent doc</span> — that doc
            steers what its research session looks for.
          </p>
        </header>

        {/* Workbench: interests (left) + live chat (right) on desktop; stacked
            on mobile with the composer pinned to the bottom of the dock. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
          {/* Interests column */}
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
                body="Ask Scout to start tracking a topic — it'll appear here with its intent doc."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {cards.map((card) => (
                  <li key={card.key}>
                    <InterestDocCard
                      model={card}
                      focused={focusKey === card.key}
                      onFocusToggle={() =>
                        setFocusKey((cur) =>
                          cur === card.key ? null : card.key,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Chat column */}
          <ChatDock
            messages={messages}
            sending={sending}
            error={error}
            focusTopic={focusTopic}
            onClearFocus={() => setFocusKey(null)}
            onSend={send}
          />
        </div>

        {/* Delivery schedule (PER-152). Relocated here from the removed in-page
            settings screen (PER-188) so the profile is the single surface for
            everything about what Scout researches and when it delivers. */}
        <section className="max-w-2xl border-t border-border-default pt-8">
          <h2 className="mb-4 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Delivery schedule
          </h2>
          <ScheduleSettings />
        </section>
      </div>
    </main>
  );
}

function ProfileSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded-lg border border-border-default bg-surface p-4"
        >
          <div className="space-y-2">
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-muted" />
            <div className="h-2.5 w-28 animate-pulse rounded bg-surface-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
