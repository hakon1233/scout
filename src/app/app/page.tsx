"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
  fetchLatestBrief,
  generateWeeklyBrief,
  loadCompanionToken,
  pingCompanion,
  refreshBriefViaCompanion,
} from "@/lib/companion";
import { fetchRunFailure, type RunFailure } from "@/lib/run-failure";
import { fetchCompanionInterestSet } from "@/lib/interest-docs";
import { formatDate } from "@/lib/format-date";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import {
  useAbortableController,
  useAbortableEffect,
} from "@/hooks/useAbortableEffect";
import { SAMPLE_BRIEF } from "@/lib/sample-brief";
import {
  loadLastBrief,
  loadSettings,
  saveLastBrief,
  saveSettings,
} from "@/lib/storage";
import type { Brief, Settings } from "@/lib/types";

const INTERESTS_PATH = "/app/interests";

// The "not paired" guidance is the same whether the user hit Generate or the
// weekly action — keep one copy so the two run paths never drift (PER-/FLI lanes
// have re-touched both call sites independently before).
const COMPANION_NOT_PAIRED_MSG =
  "Scout companion isn't paired yet. Start `scout-agent run` and open the app it prints, or visit /app/connect to pair.";

// Bucket a brief's topics into the two states the UI treats differently.
// `missing` = the model dropped the section → actionable, Retry can
// recover it. `empty` = a section exists but had no fresh news today → honest,
// NOT an error, NOT retryable. Prefers the companion's authoritative `topics`;
// falls back to the legacy client-side `failedTopics` for briefs cached before
// the companion reported coverage (treated as missing, since the old field
// meant "didn't come back"). Exported so it can be unit-tested directly.
export function coverageBuckets(b: Brief): {
  missing: string[];
  empty: string[];
} {
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

function topicFilterKey(topic: string): string {
  return topic.trim().toLowerCase();
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
  // Whether the in-flight run can actually be cancelled. A daily/retry/selected
  // run threads an AbortController through refreshBriefViaCompanion, so Cancel
  // aborts it; the weekly digest assembles synchronously via generateWeeklyBrief
  // (no signal), so there is nothing to abort. Drives the progress panel's Cancel
  // button so it never shows a dead control during a weekly run.
  const [cancelable, setCancelable] = useState(true);
  // Explicit success state for an on-demand "Run now". Holds the
  // generated_at of the most recent run that completed in THIS session, so we
  // can show a "fresh brief delivered" confirmation instead of silently
  // swapping the brief. Cleared whenever a new run starts or context changes.
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [companionReady, setCompanionReady] = useState(false);
  // Surfaced "your daily run failed / silently stopped" signal.
  // Read-only telemetry from the companion; null when the run is healthy.
  const [runFailure, setRunFailure] = useState<RunFailure | null>(null);
  // A single story can be opened from EITHER the current edition or the
  // history pager. We track the origin separately because the two
  // collapse in opposite directions: a current-edition story hides the history
  // pager below it, while a history-pager story hides the current edition ABOVE
  // it. Collapsing the wrong one would unmount the very feed holding the open
  // story. `storyOpen` (either source) drives the page chrome (banners) which
  // hides in both cases.
  const [todayStoryOpen, setTodayStoryOpen] = useState(false);
  const [historyStoryOpen, setHistoryStoryOpen] = useState(false);
  const storyOpen = todayStoryOpen || historyStoryOpen;
  // Client-side interest filter. null = show all; string = show only
  // articles whose `interest` field matches that topic. Never mutates settings.
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const { startAbortable, clearAbortable, abortCurrent } =
    useAbortableController();

  useEffect(() => {
    // Hydrate from localStorage on mount. Static export means first render runs
    // at build time with no window; this is the canonical sync point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
    setBrief(loadLastBrief());
    setHydrated(true);
  }, []);

  useAbortableEffect(
    (scope) => {
      if (!hydrated) return;
      const check = async () => {
        // When served from the companion, this also auto-adopts the pairing
        // token from /v0/config so no manual paste is needed.
        const token = await bootstrapCompanionToken();
        const ok = token ? await pingCompanion() : false;
        if (!scope.cancelled) setCompanionReady(ok);
        // Poll run health alongside the reachability ping so a
        // silently-failed daily run (or a stale feed with no run in >26h) is
        // surfaced instead of the feed quietly showing yesterday's edition.
        const failure = ok && token ? await fetchRunFailure(token) : null;
        if (!scope.cancelled) setRunFailure(failure);
      };
      check();
      // Back off the poll once the companion is confirmed ready. While
      // unpaired we poll fast (10s) so first pairing feels instant; once ready
      // we widen to 30s — steady background /healthz traffic and main-thread
      // wakeups drop 3x for no behaviour change. Drop-out is still detected
      // within one slow tick: the next check flips companionReady=false,
      // which re-runs this effect and restores the 10s cadence.
      const id = setInterval(check, companionReady ? 30_000 : 10_000);
      return () => {
        clearInterval(id);
      };
    },
    [hydrated, companionReady],
  );

  useAbortableEffect(
    (scope) => {
      // On load, pull the latest ready brief from the paired companion so a brief
      // generated in a previous session shows immediately — not the hardcoded
      // example. Only adopt it when it's newer than whatever we cached locally,
      // and never while a generation is already in flight.
      if (!hydrated) return;
      (async () => {
        const token = await bootstrapCompanionToken();
        if (!token || scope.cancelled) return;
        const latest = await fetchLatestBrief(token);
        if (scope.cancelled || !latest || running) return;
        // Per-topic coverage now rides along on the brief (`latest.topics`),
        // computed authoritatively by the companion. We no longer reverse-engineer
        // "failed" topics here via a case-sensitive heading diff — that brittle
        // match (e.g. "openai" vs the model's "## OpenAI") was the source of the
        // false "topic didn't come back" reports and the dead Retry.
        setBrief((prev) => {
          if (prev && prev.generatedAt >= latest.generatedAt) return prev;
          // Do NOT rotate scout.prevBrief.v1 here. This adoption is a
          // non-destructive "show the newest brief on load," not the audited
          // user-initiated overwrite — only generate() archives the outgoing
          // brief. Rotating here would clobber a real previous edition with a
          // brief the user never replaced by hand.
          saveLastBrief(latest);
          return latest;
        });
      })();
    },
    // Runs once after hydration; `running` is intentionally read at fire time.
    [hydrated],
  );

  useAbortableEffect(
    (scope) => {
      // The companion holds the reader's interests (its scheduler runs from
      // them), so mirror its list into local settings: a browser that never
      // did setup here gets a usable feed instead of the setup form, and one
      // that did follows interests added, removed or renamed in the profile
      // chat. The reader's name stays local.
      if (!hydrated) return;
      (async () => {
        const stored = loadSettings();
        const token = await bootstrapCompanionToken();
        const set = await fetchCompanionInterestSet(
          token,
          stored?.interests ?? [],
        );
        if (scope.cancelled || !set) return;
        // The reader saved settings while this was in flight: theirs win.
        if (JSON.stringify(loadSettings()) !== JSON.stringify(stored)) return;
        const next: Settings = {
          name: stored?.name ?? "",
          interests: set.interests,
        };
        if (JSON.stringify(next) === JSON.stringify(stored)) return;
        saveSettings(next);
        setSettings(next);
      })();
    },
    [hydrated],
  );

  // Single brief path: the local Scout companion. The browser→Exa path was
  // removed — it fetched api.exa.ai directly and was CORS-broken.
  // The companion runs the local `claude` CLI over the loopback server, so
  // there are no API keys and no cross-origin calls.
  const generate = useCallback(
    async (opts?: { retryTopics?: string[] }) => {
      if (!settings) return;
      const allTopics = settings.interests.map((i) => i.topic);
      // Only honor a retry subset that's still in the current interest list; the
      // companion re-checks too, but this keeps the progress panel honest.
      const retryTopics = (opts?.retryTopics ?? []).filter((t) =>
        allTopics.includes(t),
      );
      const isRetry = retryTopics.length > 0;
      const token = loadCompanionToken();
      if (!token) {
        setError(classifyError(new Error(COMPANION_NOT_PAIRED_MSG)));
        return;
      }
      const controller = startAbortable();
      setRunning(true);
      setCancelable(true);
      setError(null);
      setCancelled(false);
      setRanAt(null);
      // A run replaces the on-screen brief, so any open single-story detail is
      // about to unmount (the feed block swaps to the skeleton). Reset the
      // story-open flags so the run's progress panel + skeleton — both gated on
      // `!storyOpen` — actually render. Without this, pressing Run now while
      // reading a story left `todayStoryOpen`/`historyStoryOpen` stuck true (the
      // unmounting FeedView never fires onDetailOpenChange(false)), so the whole
      // content area went blank with zero progress for the entire multi-minute run.
      setTodayStoryOpen(false);
      setHistoryStoryOpen(false);
      setProgress({
        stage: "synthesizing",
        message: isRetry
          ? `Companion is re-researching ${retryTopics.length} topic${retryTopics.length === 1 ? "" : "s"}…`
          : "Companion is fetching & synthesizing your brief…",
        // On a focused retry, only the retried topics are "working"; the rest are
        // carried over from the prior brief, so show them as already done.
        perInterest: allTopics.map((topic) => ({
          topic,
          state: isRetry && !retryTopics.includes(topic) ? "done" : "pending",
        })),
      });
      try {
        const since = brief?.generatedAt ?? new Date(0).toISOString();
        const next = await refreshBriefViaCompanion(
          // Always send the FULL interest list: the companion persists it as the
          // scheduler's source of truth.
          allTopics,
          token,
          {
            sinceTs: since,
            signal: controller.signal,
            retryTopics: isRetry ? retryTopics : undefined,
          },
        );
        // Per-topic status rides along on `next.topics` from the companion — no
        // client-side heading diff. The outgoing brief isn't archived
        // client-side anymore: previous editions now come from the companion's
        // rolling history via the BriefHistory pager, so there's no
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
        clearAbortable(controller);
      }
    },
    [settings, brief, startAbortable, clearAbortable],
  );

  // Retry ONLY the topics the model dropped (status "missing"), merging the
  // fresh sections into the prior brief instead of regenerating everything
  // Falls back to a full run if there's nothing structured to retry.
  const retryMissingTopics = useCallback(() => {
    const missing = brief ? coverageBuckets(brief).missing : [];
    if (missing.length === 0) return generate();
    return generate({ retryTopics: missing });
  }, [brief, generate]);

  // Zero-arg wrapper for UI handler props (profile-menu Run-now / onRetry).
  // `generate` takes an optional `{ retryTopics }`, so binding it directly to a
  // DOM event handler would forward the MouseEvent as that argument.
  const runNow = useCallback(() => {
    void generate();
  }, [generate]);

  const runWeekly = useCallback(async () => {
    const token = loadCompanionToken();
    if (!token) {
      setError(classifyError(new Error(COMPANION_NOT_PAIRED_MSG)));
      return;
    }
    setRunning(true);
    setCancelable(false);
    setError(null);
    setCancelled(false);
    setRanAt(null);
    // Same reason as generate(): close any open story so the run's progress
    // panel + skeleton (gated on `!storyOpen`) render instead of a blank area.
    setTodayStoryOpen(false);
    setHistoryStoryOpen(false);
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
    abortCurrent();
  }, [abortCurrent]);

  if (!hydrated) {
    return (
      <Shell>
        <AppSkeleton />
      </Shell>
    );
  }

  if (!settings) {
    // No stored config yet (and the companion held no interests to adopt). The
    // in-page keyword setup form was removed — interests are now set
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

  // An active filter can outlive its topic. Renaming or
  // deleting an interest (via the profile chat) updates settings.interests but
  // leaves activeFilter pointing at the old topic string. Honoring a stale value
  // would wedge the feed into an empty "No stories in this edition yet." view
  // filtering on a topic that no longer exists — while the funnel shows a
  // "Filtering by <gone>" state the menu can't un-highlight. Treat a filter whose
  // topic is no longer in the interest list as "all topics". Purely derived (no
  // extra state/effect), so the moment the user picks any option it's overwritten.
  const filterIsLive =
    activeFilter !== null &&
    settings.interests.some(
      (i) => topicFilterKey(i.topic) === topicFilterKey(activeFilter),
    );
  const effectiveFilter = filterIsLive ? activeFilter : null;

  // Derive a filtered brief for BriefLayout; leaves the stored brief
  // untouched. When no filter is active we pass the brief as-is.
  const filteredBrief =
    brief && effectiveFilter
      ? {
          ...brief,
          articles: brief.articles.filter(
            (a) =>
              topicFilterKey(a.interest) === topicFilterKey(effectiveFilter),
          ),
        }
      : brief;

  return (
    <Shell
      onRunNow={runNow}
      onWeeklyBrief={() => void runWeekly()}
      running={running}
      interests={settings.interests}
      activeFilter={effectiveFilter}
      onFilterChange={setActiveFilter}
    >
      {/* Every banner/skeleton here is page chrome that sits around the
          feed. In single-story mode the reader wants ONLY the story, so the
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

          {/* Honestly surface a silently-failed daily run. A failed run
          overwrites last_brief with status:"failed", and the feed used to keep
          quietly showing yesterday's edition — read as "no new run". Now the
          user sees a clear banner with the captured reason.
          Suppressed while a run is in flight or a fresh brief just landed this
          session (the failure is already resolved), and when an error banner is
          already speaking for the current action. */}
          {runFailure && !running && !ranAt && !error && (
            <Banner tone="warning">
              <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {runFailure.kind === "failed" ? (
                    <>
                      Today&apos;s brief failed
                      {runFailure.reason ? (
                        <>
                          {" — "}
                          <span className="font-medium">
                            {runFailure.reason}
                          </span>
                        </>
                      ) : (
                        "."
                      )}{" "}
                      Scout retries automatically; you can also run it now.
                      {runFailure.lastSuccessAt && (
                        <>
                          {" "}
                          <span className="text-muted">
                            Showing your last good brief from{" "}
                            {formatDate(runFailure.lastSuccessAt)}.
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      No fresh brief in over a day
                      {runFailure.lastSuccessAt ? (
                        <>
                          {" "}
                          — the last successful run was{" "}
                          <span className="font-medium">
                            {formatDate(runFailure.lastSuccessAt)}
                          </span>
                          .
                        </>
                      ) : (
                        "."
                      )}{" "}
                      Scout may have stopped; try running it now.
                    </>
                  )}
                </span>
                <Button variant="secondary" size="sm" onClick={runNow}>
                  Run now
                </Button>
              </span>
            </Banner>
          )}

          {/* Explicit success state for an on-demand run — a fresh brief
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
            <AgentProgressPanel
              progress={progress}
              onCancel={cancel}
              canCancel={cancelable}
            />
          )}

          {showSkeleton && <BriefSkeleton />}

          {cancelled && !running && <Banner tone="info">Cancelled.</Banner>}

          {error && <ErrorBanner error={error} onRetry={runNow} />}

          {/* Distinguish two honest states. "Missing" = the model dropped
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
          {/* The clean current edition — header reads exactly
              "Your brief — <date>", then straight into headlines.
              BriefLayout reports when a story detail is open so the
              page can collapse to that single story.
              When a HISTORY-pager story is open instead, collapse the
              current edition away too so only the focused story remains.
              filteredBrief has articles narrowed by activeFilter. */}
          {!historyStoryOpen && (
            <BriefLayout
              brief={filteredBrief}
              name=""
              onDetailOpenChange={setTodayStoryOpen}
            />
          )}
          {/* Previous editions, paged 3 at a time from the
              companion's rolling history, with "Load older briefs" + "Manage
              interests" at the bottom. Hidden when a CURRENT-edition
              story is open so nothing from the feed shows below it.
              When a story is opened FROM the pager, it stays mounted
              (it holds the open story) and collapses internally to that one
              section, reporting up via onDetailOpenChange. */}
          {!todayStoryOpen && (
            <BriefHistory
              token={loadCompanionToken()}
              currentBriefId={filteredBrief.id}
              activeFilter={effectiveFilter}
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
              Example brief — open Settings (top right) and click{" "}
              <span className="font-medium">Run now</span> to make your own.
            </Banner>
            <BriefLayout brief={SAMPLE_BRIEF} name={settings.name} />
          </div>
        )
      )}
    </Shell>
  );
}

// The Scout wordmark (top-left logo slot) and the profile
// menu both live in AppNav. The feed view threads its Run-now wiring through so
// the action shows inside the profile menu; other states omit it.
// Also threads interest filter props through to AppNav.
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
  interests?: import("@scout/agent/contract").Interest[];
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
