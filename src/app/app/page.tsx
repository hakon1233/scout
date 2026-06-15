"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentProgressPanel } from "@/components/AgentProgressPanel";
import { AppNav } from "@/components/AppNav";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefHistory } from "@/components/BriefHistory";
import { BriefLayout } from "@/components/BriefLayout";
import { BriefSkeleton } from "@/components/BriefSkeleton";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Banner, Button } from "@/components/ui";
import type { AgentProgress } from "@/lib/agent";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
  fetchLatestBrief,
  generateWeeklyBrief,
  loadCompanionToken,
  pingCompanion,
  refreshBriefViaCompanion,
} from "@/lib/companion";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import { SAMPLE_BRIEF } from "@/lib/sample-brief";
import {
  loadLastBrief,
  loadSettings,
  saveLastBrief,
  saveSettings,
} from "@/lib/storage";
import type { Brief, Settings } from "@/lib/types";

const INTERESTS_PATH = "/app/interests";

// Bucket a brief's topics into the two states the UI treats differently
// (PER-154). `missing` = the model dropped the section → actionable, Retry can
// recover it. `empty` = a section exists but had no fresh news today → honest,
// NOT an error, NOT retryable. Prefers the companion's authoritative `topics`;
// falls back to the legacy client-side `failedTopics` for briefs cached before
// PER-154 (treated as missing, since the old field meant "didn't come back").
function coverageBuckets(b: Brief): { missing: string[]; empty: string[] } {
  if (b.topics && b.topics.length > 0) {
    return {
      missing: b.topics
        .filter((t) => t.status === "missing")
        .map((t) => t.topic),
      empty: b.topics.filter((t) => t.status === "empty").map((t) => t.topic),
    };
  }
  return { missing: b.failedTopics ?? [], empty: [] };
}

export default function AppPage() {
  const router = useRouter();
  const goToInterests = useCallback(
    () => router.push(INTERESTS_PATH),
    [router],
  );
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [running, setRunning] = useState(false);
  // PER-150: explicit success state for an on-demand "Run now". Holds the
  // generated_at of the most recent run that completed in THIS session, so we
  // can show a "fresh brief delivered" confirmation instead of silently
  // swapping the brief. Cleared whenever a new run starts or context changes.
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [companionReady, setCompanionReady] = useState(false);
  // PER-222: a single story can be opened from EITHER the current edition or the
  // history pager. We track the origin separately (PER-223 fix) because the two
  // collapse in opposite directions: a current-edition story hides the history
  // pager below it, while a history-pager story hides the current edition ABOVE
  // it. Collapsing the wrong one would unmount the very feed holding the open
  // story. `storyOpen` (either source) drives the page chrome (banners) which
  // hides in both cases.
  const [todayStoryOpen, setTodayStoryOpen] = useState(false);
  const [historyStoryOpen, setHistoryStoryOpen] = useState(false);
  const storyOpen = todayStoryOpen || historyStoryOpen;
  // PER-241: client-side interest filter. null = show all; string = show only
  // articles whose `interest` field matches that topic. Never mutates settings.
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Hydrate from localStorage on mount. Static export means first render runs
    // at build time with no window; this is the canonical sync point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrief(loadLastBrief());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const check = async () => {
      // When served from the companion, this also auto-adopts the pairing
      // token from /v0/config so no manual paste is needed.
      const token = await bootstrapCompanionToken();
      const ok = token ? await pingCompanion() : false;
      if (!cancelled) setCompanionReady(ok);
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hydrated]);

  useEffect(() => {
    // On load, pull the latest ready brief from the paired companion so a brief
    // generated in a previous session shows immediately — not the hardcoded
    // example. Only adopt it when it's newer than whatever we cached locally,
    // and never while a generation is already in flight.
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      const token = await bootstrapCompanionToken();
      if (!token || cancelled) return;
      const latest = await fetchLatestBrief(token);
      if (cancelled || !latest || running) return;
      // Per-topic coverage now rides along on the brief (`latest.topics`),
      // computed authoritatively by the companion. We no longer reverse-engineer
      // "failed" topics here via a case-sensitive heading diff — that brittle
      // match (e.g. "openai" vs the model's "## OpenAI") was the source of the
      // false "topic didn't come back" reports and the dead Retry (PER-154).
      setBrief((prev) => {
        if (prev && prev.generatedAt >= latest.generatedAt) return prev;
        // PER-146: do NOT rotate scout.prevBrief.v1 here. This adoption is a
        // non-destructive "show the newest brief on load," not the audited
        // user-initiated overwrite — only generate() archives the outgoing
        // brief. Rotating here would clobber a real previous edition with a
        // brief the user never replaced by hand.
        saveLastBrief(latest);
        return latest;
      });
    })();
    return () => {
      cancelled = true;
    };
    // Runs once after hydration; `running` is intentionally read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    // PER-157: when this browser has NO locally-saved settings but the companion
    // (the source of truth) holds the user's interests, adopt them. Without this
    // the app dead-ends on the setup form — and silently drops the ready brief it
    // already fetched above — for any browser that didn't do first-run setup here
    // (cleared storage, a different profile, or a different origin than the one
    // the companion now serves). The result reads as "Run now doesn't work."
    // Only fires when nothing is stored locally: a real saved config (with the
    // user's name + curated interests) always wins and is never overwritten.
    if (!hydrated) return;
    if (loadSettings()) return;
    let cancelled = false;
    (async () => {
      const topics = await fetchCompanionInterests();
      if (cancelled || topics.length === 0) return;
      // Re-check: the user may have completed setup while this was in flight.
      if (loadSettings()) return;
      const adopted: Settings = {
        name: "",
        interests: topics.map((topic, i) => ({
          id: `int_${i}_${topic.slice(0, 12)}`,
          topic,
        })),
      };
      saveSettings(adopted);
      setSettings(adopted);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    // PER-191: keep the run-selector's interest list aligned with the companion's
    // ACTUAL interests. The adoption effect above only seeds an EMPTY browser; a
    // browser that set up earlier keeps its saved list verbatim, so when the user
    // later adds/removes/renames interests via the profile chat, `settings.interests`
    // drifts. The brief (built by the companion) then shows more `## topic` sections
    // than the run-selector offers chips for — the founder's "way more topics than
    // what we can filter by." Reconcile topics here (preserving the user's name and
    // any existing stable ids) so run-selector, brief sections, and the brief filter
    // all derive from one source of truth. No-op when nothing changed.
    if (!hydrated) return;
    const stored = loadSettings();
    if (!stored || stored.interests.length === 0) return; // empty → adoption handles it
    let cancelled = false;
    (async () => {
      const topics = await fetchCompanionInterests();
      if (cancelled || topics.length === 0) return;
      const idByTopic = new Map(
        stored.interests.map((i) => [i.topic.trim().toLowerCase(), i.id]),
      );
      const current = stored.interests.map((i) => i.topic);
      const sameOrder =
        current.length === topics.length &&
        current.every((t, idx) => t === topics[idx]);
      if (sameOrder) return; // already aligned — nothing to write
      const reconciled: Settings = {
        name: stored.name,
        interests: topics.map((topic, i) => ({
          id:
            idByTopic.get(topic.trim().toLowerCase()) ??
            `int_${i}_${topic.slice(0, 12)}`,
          topic,
        })),
      };
      saveSettings(reconciled);
      if (!cancelled) setSettings(reconciled);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Single brief path: the local Scout companion. The browser→Exa path was
  // removed (PER-109) — it fetched api.exa.ai directly and was CORS-broken.
  // The companion runs the local `claude` CLI over the loopback server, so
  // there are no API keys and no cross-origin calls.
  const generate = useCallback(
    async (opts?: { retryTopics?: string[]; selectedTopics?: string[] }) => {
      if (!settings) return;
      const allTopics = settings.interests.map((i) => i.topic);
      // Only honor a retry subset that's still in the current interest list; the
      // companion re-checks too, but this keeps the progress panel honest.
      const retryTopics = (opts?.retryTopics ?? []).filter((t) =>
        allTopics.includes(t),
      );
      const isRetry = retryTopics.length > 0;
      // Run-selector subset (C6/PER-173): a STRICT subset of the interest list,
      // ignored on a retry (which carries its own subset) and collapsed to a
      // full run when it covers everything. The companion mirrors this gate.
      const selectedTopics = (opts?.selectedTopics ?? []).filter((t) =>
        allTopics.includes(t),
      );
      const isSelected =
        !isRetry &&
        selectedTopics.length > 0 &&
        selectedTopics.length < allTopics.length;
      // The topics this run actually researches — drives the progress panel so
      // it shows only the sessions that will fire.
      const runningTopics = isSelected ? selectedTopics : allTopics;
      const token = loadCompanionToken();
      if (!token) {
        setError(
          classifyError(
            new Error(
              "Scout companion isn't paired yet. Start `scout-agent run` and open the app it prints, or visit /app/connect to pair.",
            ),
          ),
        );
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      setCancelled(false);
      setRanAt(null);
      setProgress({
        stage: "synthesizing",
        message: isRetry
          ? `Companion is re-researching ${retryTopics.length} topic${retryTopics.length === 1 ? "" : "s"}…`
          : isSelected
            ? `Companion is fetching ${selectedTopics.length} of ${allTopics.length} topics…`
            : "Companion is fetching & synthesizing your brief…",
        // On a focused retry, only the retried topics are "working"; the rest are
        // carried over from the prior brief, so show them as already done. On a
        // selected run, only the chosen topics fire at all — show just those.
        perInterest: runningTopics.map((topic) => ({
          topic,
          state: isRetry && !retryTopics.includes(topic) ? "done" : "pending",
        })),
      });
      try {
        const since = brief?.generatedAt ?? new Date(0).toISOString();
        const next = await refreshBriefViaCompanion(
          // Always send the FULL interest list — the companion persists it as the
          // scheduler's source of truth; `selectedTopics` only narrows THIS run.
          allTopics,
          token,
          {
            sinceTs: since,
            signal: controller.signal,
            retryTopics: isRetry ? retryTopics : undefined,
            selectedTopics: isSelected ? selectedTopics : undefined,
          },
        );
        // Per-topic status rides along on `next.topics` from the companion — no
        // client-side heading diff (PER-154). The outgoing brief isn't archived
        // client-side anymore: previous editions now come from the companion's
        // rolling history via the BriefHistory pager (PER-219), so there's no
        // local prevBrief slot to rotate.
        saveLastBrief(next);
        setBrief(next);
        setProgress(null);
        setRanAt(next.generatedAt);
      } catch (e) {
        if (controller.signal.aborted || (e as Error)?.message === "aborted") {
          setCancelled(true);
        } else {
          setError(classifyError(e));
        }
        setProgress(null);
      } finally {
        setRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [settings, brief],
  );

  // Retry ONLY the topics the model dropped (status "missing"), merging the
  // fresh sections into the prior brief instead of regenerating everything
  // (PER-154). Falls back to a full run if there's nothing structured to retry.
  const retryMissingTopics = useCallback(() => {
    const missing = brief ? coverageBuckets(brief).missing : [];
    if (missing.length === 0) return generate();
    return generate({ retryTopics: missing });
  }, [brief, generate]);

  // Zero-arg wrapper for UI handler props (profile-menu Run-now / onRetry).
  // `generate` takes an optional `{ retryTopics, selectedTopics }`, so binding it
  // directly to a DOM event handler would forward the MouseEvent as that argument
  // (and fail strict type-checking). PER-219: the run-scope selector was removed
  // (AC5) — Run-now always fires a full pass over the saved interest list.
  const runNow = useCallback(() => {
    void generate();
  }, [generate]);

  const runWeekly = useCallback(async () => {
    const token = loadCompanionToken();
    if (!token) {
      setError(
        classifyError(
          new Error(
            "Scout companion isn't paired yet. Start `scout-agent run` and open the app it prints, or visit /app/connect to pair.",
          ),
        ),
      );
      return;
    }
    setRunning(true);
    setError(null);
    setCancelled(false);
    setRanAt(null);
    setProgress({
      stage: "synthesizing",
      message:
        "Scout is assembling your weekly brief from the last seven days…",
      perInterest: [],
    });
    try {
      const next = await generateWeeklyBrief(token);
      saveLastBrief(next);
      setBrief(next);
      setProgress(null);
      setRanAt(next.generatedAt);
    } catch (e) {
      setError(classifyError(e));
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (!hydrated) {
    return (
      <Shell>
        <AppSkeleton />
      </Shell>
    );
  }

  if (!settings) {
    // No stored config yet (and the companion held no interests to adopt). The
    // in-page keyword setup form was removed in PER-188 — interests are now set
    // and managed exclusively in the chat-driven profile. Show the example brief
    // and route the single "Manage interests" affordance there.
    return (
      <Shell>
        <header className="flex flex-col gap-3 border-b border-border-default pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-caption uppercase text-muted">Scout · MVP</p>
            <h1 className="text-title-1 text-primary">Your brief</h1>
            <p className="text-body-sm text-muted">
              Tell Scout what you want to follow, then run your first brief.
            </p>
          </div>
          <Button variant="primary" onClick={goToInterests}>
            Manage interests
          </Button>
        </header>

        <Banner tone="info">
          Example brief — set up your interests to make your own.
        </Banner>
        <BriefLayout brief={SAMPLE_BRIEF} name="" />
      </Shell>
    );
  }

  const showSkeleton = progress?.stage === "synthesizing";

  // PER-241: derive a filtered brief for BriefLayout; leaves the stored brief
  // untouched. When no filter is active we pass the brief as-is.
  const filteredBrief =
    brief && activeFilter
      ? {
          ...brief,
          articles: brief.articles.filter((a) => a.interest === activeFilter),
        }
      : brief;

  return (
    <Shell
      onRunNow={runNow}
      onWeeklyBrief={() => void runWeekly()}
      running={running}
      interests={settings.interests}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
    >
      {/* PER-222: every banner/skeleton here is page chrome that sits around the
          feed. In single-story mode the founder wants ONLY the story, so the
          whole cluster collapses while a story is open. */}
      {!storyOpen && (
        <>
          {!companionReady && (
            <Banner tone="info">
              <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Scout builds your brief with its local companion. Start{" "}
                  <code className="font-mono text-mono-xs">
                    scout-agent run
                  </code>{" "}
                  and open the app link it prints.
                </span>
                <Link
                  href="/app/connect"
                  className="shrink-0 text-caption uppercase text-muted underline transition hover:text-primary"
                >
                  Pair companion →
                </Link>
              </span>
            </Banner>
          )}

          {/* PER-150: explicit success state for an on-demand run — a fresh brief
          actually landed, not a silent swap. Suppressed while another run
          starts or an error is showing. */}
          {ranAt && !running && !error && (
            <Banner tone="success" aria-live="polite">
              Fresh brief delivered ·{" "}
              {new Date(ranAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Banner>
          )}

          {progress && (
            <AgentProgressPanel progress={progress} onCancel={cancel} />
          )}

          {showSkeleton && <BriefSkeleton />}

          {cancelled && !running && <Banner tone="info">Cancelled.</Banner>}

          {error && <ErrorBanner error={error} onRetry={runNow} />}

          {/* PER-154: distinguish two honest states. "Missing" = the model dropped
          the section → warning + a Retry that re-researches ONLY those topics.
          "Empty" = a section came back with no fresh news today → info, not an
          error, no Retry (re-running won't conjure news that doesn't exist). */}
          {brief &&
            !running &&
            (() => {
              const { missing, empty } = coverageBuckets(brief);
              return (
                <>
                  {missing.length > 0 && (
                    <Banner tone="warning">
                      <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                          Some topics didn&apos;t come back:{" "}
                          <span className="font-medium">
                            {missing.join(", ")}
                          </span>
                          .
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={retryMissingTopics}
                        >
                          Retry{" "}
                          {missing.length === 1
                            ? "topic"
                            : `${missing.length} topics`}
                        </Button>
                      </span>
                    </Banner>
                  )}
                  {empty.length > 0 && (
                    <Banner tone="info" aria-live="polite">
                      No fresh news today for{" "}
                      <span className="font-medium">{empty.join(", ")}</span>.
                      We checked — there just wasn&apos;t anything new worth
                      flagging.
                    </Banner>
                  )}
                </>
              );
            })()}
        </>
      )}

      {filteredBrief && !showSkeleton ? (
        <>
          {/* PER-219 (AC1): the clean current edition — header reads exactly
              "Your brief — <date>", then straight into headlines.
              PER-222: BriefLayout reports when a story detail is open so the
              page can collapse to that single story.
              PER-223: when a HISTORY-pager story is open instead, collapse the
              current edition away too so only the focused story remains.
              PER-241: filteredBrief has articles narrowed by activeFilter. */}
          {!historyStoryOpen && (
            <BriefLayout
              brief={filteredBrief}
              name=""
              onDetailOpenChange={setTodayStoryOpen}
            />
          )}
          {/* PER-219 (AC6): previous editions, paged 3 at a time from the
              companion's rolling history, with "Load older briefs" + "Manage
              interests" at the bottom. PER-222: hidden when a CURRENT-edition
              story is open so nothing from the feed shows below it.
              PER-223: when a story is opened FROM the pager, it stays mounted
              (it holds the open story) and collapses internally to that one
              section, reporting up via onDetailOpenChange. */}
          {!todayStoryOpen && (
            <BriefHistory
              token={loadCompanionToken()}
              currentBriefId={filteredBrief.id}
              onManageInterests={goToInterests}
              onDetailOpenChange={setHistoryStoryOpen}
            />
          )}
        </>
      ) : (
        !running &&
        !brief &&
        !error && (
          <div className="flex flex-col gap-3">
            <Banner tone="info">
              Example brief — open the profile menu and click{" "}
              <span className="font-medium">Run now</span> to make your own.
            </Banner>
            <BriefLayout brief={SAMPLE_BRIEF} name={settings.name} />
          </div>
        )
      )}
    </Shell>
  );
}

// PER-219 (AC3/AC4): the Scout wordmark (top-left logo slot) and the profile
// menu both live in AppNav. The feed view threads its Run-now wiring through so
// the action shows inside the profile menu; other states omit it.
// PER-241: also threads interest filter props through to AppNav.
function Shell({
  children,
  onRunNow,
  onWeeklyBrief,
  running,
  interests,
  activeFilter,
  onFilterChange,
}: {
  children: React.ReactNode;
  onRunNow?: () => void;
  onWeeklyBrief?: () => void;
  running?: boolean;
  interests?: import("@/lib/types").Interest[];
  activeFilter?: string | null;
  onFilterChange?: (topic: string | null) => void;
}) {
  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <AppNav
          onRunNow={onRunNow}
          onWeeklyBrief={onWeeklyBrief}
          running={running}
          interests={interests}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        />
        {children}
      </div>
    </main>
  );
}
