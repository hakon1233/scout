"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentProgressPanel } from "@/components/AgentProgressPanel";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefLayout } from "@/components/BriefLayout";
import { BriefSkeleton } from "@/components/BriefSkeleton";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InterestChips } from "@/components/InterestChips";
import { ScheduleSettings } from "@/components/ScheduleSettings";
import { SetupForm } from "@/components/SetupForm";
import { Banner, Button } from "@/components/ui";
import type { AgentProgress } from "@/lib/agent";
import {
  bootstrapCompanionToken,
  fetchLatestBrief,
  loadCompanionToken,
  pingCompanion,
  refreshBriefViaCompanion,
} from "@/lib/companion";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import { SAMPLE_BRIEF } from "@/lib/sample-brief";
import {
  clearSettings,
  loadLastBrief,
  loadPrevBrief,
  loadSettings,
  saveLastBrief,
  savePrevBrief,
  saveSettings,
} from "@/lib/storage";
import type { Brief, Interest, Settings } from "@/lib/types";

const STICKY_THRESHOLD_PX = 480;

// Mirrors BriefLayout's header date format so the "filed {date}" recovery
// affordance and the PREVIOUS banner read identically to the brief header.
function formatBriefDate(b: Brief): string {
  return new Date(b.generatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AppPage() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  // PER-146: one-deep recoverable archive of the brief a regenerate replaced.
  const [prevBrief, setPrevBrief] = useState<Brief | null>(null);
  const [viewingPrev, setViewingPrev] = useState(false);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [running, setRunning] = useState(false);
  // PER-150: explicit success state for an on-demand "Run now". Holds the
  // generated_at of the most recent run that completed in THIS session, so we
  // can show a "fresh brief delivered" confirmation instead of silently
  // swapping the brief. Cleared whenever a new run starts or context changes.
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [interestsChanged, setInterestsChanged] = useState(false);
  const [companionReady, setCompanionReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateInterests = useCallback(
    (next: Interest[]) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, interests: next };
        saveSettings(updated);
        return updated;
      });
      setInterestsChanged(true);
      // A "fresh brief delivered" confirmation is stale the moment interests
      // change — the out-of-date banner takes over instead.
      setRanAt(null);
    },
    [],
  );

  useEffect(() => {
    // Hydrate from localStorage on mount. Static export means first render runs
    // at build time with no window; this is the canonical sync point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrief(loadLastBrief());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevBrief(loadPrevBrief());
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
      const topics = loadSettings()?.interests.map((i) => i.topic) ?? [];
      latest.failedTopics = topics.filter((t) => !latest.interests.includes(t));
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

  // Single brief path: the local Scout companion. The browser→Exa path was
  // removed (PER-109) — it fetched api.exa.ai directly and was CORS-broken.
  // The companion runs the local `claude` CLI over the loopback server, so
  // there are no API keys and no cross-origin calls.
  const generate = useCallback(async () => {
    if (!settings) return;
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
    setInterestsChanged(false);
    setProgress({
      stage: "synthesizing",
      message: "Companion is fetching & synthesizing your brief…",
      perInterest: settings.interests.map((i) => ({
        topic: i.topic,
        state: "pending",
      })),
    });
    try {
      const since = brief?.generatedAt ?? new Date(0).toISOString();
      const next = await refreshBriefViaCompanion(
        settings.interests.map((i) => i.topic),
        token,
        { sinceTs: since, signal: controller.signal },
      );
      next.failedTopics = settings.interests
        .map((i) => i.topic)
        .filter((t) => !next.interests.includes(t));
      // PER-146: archive the outgoing brief BEFORE overwriting the slot so a
      // regenerate is recoverable, never a silent total loss. Only in this
      // user-initiated path (see the load-time adoption effect for why not
      // there). First-ever generate has no `brief`, so no previous is created.
      if (brief) {
        savePrevBrief(brief);
        setPrevBrief(brief);
      }
      saveLastBrief(next);
      setBrief(next);
      setViewingPrev(false);
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
  }, [settings, brief]);

  // The companion regenerates the whole brief each pass, so a failed-topic
  // retry is just another full refresh.
  const retryFailedTopics = useCallback(() => generate(), [generate]);

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

  if (!settings || editing) {
    return (
      <Shell>
        <SetupForm
          initial={settings}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            setEditing(false);
            // PER-146: editing returns context to the latest edition on save.
            setViewingPrev(false);
          }}
          onClearStored={() => {
            clearSettings();
            setSettings(null);
            setBrief(null);
            setPrevBrief(null);
            setViewingPrev(false);
            setEditing(false);
          }}
        />
        {/* Schedule controls live in the settings screen, but only once the
            founder has a stored config — first-run setup stays a single focused
            step (companion isn't paired yet anyway). PER-152. */}
        {settings && (
          <div className="mt-2 border-t border-border-default pt-6">
            <ScheduleSettings />
          </div>
        )}
        {settings && (
          <Button
            variant="link"
            size="sm"
            className="mt-3 self-start"
            onClick={() => setEditing(false)}
          >
            Back to brief
          </Button>
        )}
      </Shell>
    );
  }

  // State PREVIOUS (PER-146): read-only view of the previous edition. Regenerate
  // is suppressed entirely here — you go back to latest first. Manage interests
  // stays reachable and returns context to latest on save.
  if (viewingPrev && prevBrief) {
    return (
      <Shell>
        <header className="flex flex-col gap-3 border-b border-border-default pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-caption uppercase text-muted">Scout · MVP</p>
            <h1 className="text-title-1 text-primary">
              {settings.name}&apos;s brief
            </h1>
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Manage interests
          </Button>
        </header>

        <Banner
          tone="info"
          aria-live="polite"
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Viewing your previous edition · filed {formatBriefDate(prevBrief)}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setViewingPrev(false)}
          >
            Back to latest
          </Button>
        </Banner>

        <BriefLayout brief={prevBrief} name={settings.name} preview />
      </Shell>
    );
  }

  const showSkeleton = progress?.stage === "synthesizing";

  return (
    <Shell>
      {brief && (
        <StickyUtilityBar
          running={running}
          onRegenerate={generate}
          onEditInterests={() => setEditing(true)}
        />
      )}

      <header className="flex flex-col gap-3 border-b border-border-default pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-caption uppercase text-muted">Scout · MVP</p>
          <h1 className="text-title-1 text-primary">
            {settings.name}&apos;s brief
          </h1>
          <InterestChips
            interests={settings.interests}
            onChange={updateInterests}
          />
        </div>
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Manage interests
          </Button>
          <Button
            variant="primary"
            loading={running}
            disabled={!companionReady || settings.interests.length === 0}
            onClick={generate}
            title={
              settings.interests.length === 0
                ? "Add at least one interest to run a brief"
                : companionReady
                  ? "Run a fresh research pass now with the local Scout companion"
                  : "Start the Scout companion to run a brief"
            }
          >
            {running ? "Working…" : "Run now"}
          </Button>
        </div>
      </header>

      {!companionReady && (
        <Banner tone="info">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Scout builds your brief with its local companion. Start{" "}
              <code className="font-mono text-mono-xs">scout-agent run</code>{" "}
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

      {interestsChanged && !running && (
        <Banner tone="info">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>Interests updated. Your brief is out of date.</span>
            <Button
              variant="primary"
              size="sm"
              onClick={generate}
              loading={running}
            >
              Run now
            </Button>
          </span>
        </Banner>
      )}

      {/* PER-150: explicit success state for an on-demand run — a fresh brief
          actually landed, not a silent swap. Suppressed once interests change
          (the out-of-date banner takes over) or another run starts. */}
      {ranAt && !running && !interestsChanged && !error && (
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

      {error && (
        <ErrorBanner error={error} onRetry={generate} />
      )}

      {brief?.failedTopics && brief.failedTopics.length > 0 && !running && (
        <Banner tone="warning">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Some topics didn&apos;t come back:{" "}
              <span className="font-medium">
                {brief.failedTopics.join(", ")}
              </span>
              .
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={retryFailedTopics}
            >
              Retry failed
            </Button>
          </span>
        </Banner>
      )}

      {brief && !showSkeleton ? (
        <BriefLayout
          brief={brief}
          name={settings.name}
          running={running}
          onRegenerate={generate}
          onEditInterests={() => setEditing(true)}
          onViewPrevious={
            prevBrief ? () => setViewingPrev(true) : undefined
          }
          prevDate={prevBrief ? formatBriefDate(prevBrief) : undefined}
        />
      ) : (
        !running &&
        !brief &&
        !error && (
          <div className="flex flex-col gap-3">
            <Banner tone="info">
              Example brief — click{" "}
              <span className="font-medium">Run now</span> to make your own.
            </Banner>
            <BriefLayout
              brief={SAMPLE_BRIEF}
              name={settings.name}
              preview
            />
          </div>
        )
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <nav className="flex items-center justify-between">
          <Link
            href="/"
            className="text-caption uppercase text-muted transition hover:text-primary"
          >
            ← Scout
          </Link>
        </nav>
        {children}
      </div>
    </main>
  );
}

function StickyUtilityBar({
  running,
  onRegenerate,
  onEditInterests,
}: {
  running: boolean;
  onRegenerate: () => void;
  onEditInterests: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > STICKY_THRESHOLD_PX);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-0 z-40 border-b border-border-default bg-surface/90 backdrop-blur transition-opacity ${
        visible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <p className="truncate text-caption uppercase text-muted">
          Scout · brief
        </p>
        <div className="flex flex-row gap-2">
          <Button variant="ghost" size="sm" onClick={onEditInterests}>
            Manage
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={running}
            onClick={onRegenerate}
          >
            {running ? "Working…" : "Run now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
