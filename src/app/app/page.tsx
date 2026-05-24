"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentProgressPanel } from "@/components/AgentProgressPanel";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefLayout } from "@/components/BriefLayout";
import { BriefSkeleton } from "@/components/BriefSkeleton";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InterestChips } from "@/components/InterestChips";
import { SetupForm } from "@/components/SetupForm";
import { Banner, Button, EmptyState } from "@/components/ui";
import { runAgent, type AgentProgress } from "@/lib/agent";
import {
  loadCompanionToken,
  pingCompanion,
  refreshBriefViaCompanion,
} from "@/lib/companion";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import { SAMPLE_BRIEF } from "@/lib/sample-brief";
import {
  clearSettings,
  loadLastBrief,
  loadSettings,
  saveLastBrief,
  saveSettings,
} from "@/lib/storage";
import type { Brief, Interest, Settings } from "@/lib/types";

const STICKY_THRESHOLD_PX = 480;

type EditTarget = "interests" | "keys";

export default function AppPage() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [zeroResults, setZeroResults] = useState(false);
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
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const check = async () => {
      const ok = loadCompanionToken() ? await pingCompanion() : false;
      if (!cancelled) setCompanionReady(ok);
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hydrated]);

  const refreshViaCompanion = useCallback(async () => {
    if (!settings) return;
    const token = loadCompanionToken();
    if (!token) {
      setError(classifyError(new Error("No pairing token. Visit /app/connect to pair.")));
      return;
    }
    setRunning(true);
    setError(null);
    setZeroResults(false);
    setCancelled(false);
    setInterestsChanged(false);
    setProgress({
      stage: "synthesizing",
      message: "Companion is fetching & synthesizing your brief…",
      perInterest: settings.interests.map((i) => ({ topic: i.topic, state: "pending" })),
    });
    try {
      const since = brief?.generatedAt ?? new Date(0).toISOString();
      const next = await refreshBriefViaCompanion(
        settings.interests.map((i) => i.topic),
        token,
        { sinceTs: since },
      );
      next.failedTopics = settings.interests
        .map((i) => i.topic)
        .filter((t) => !next.interests.includes(t));
      saveLastBrief(next);
      setBrief(next);
      setProgress(null);
    } catch (e) {
      setError(classifyError(e));
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }, [settings, brief]);

  const runGeneration = useCallback(
    async (onlyTopics?: string[]) => {
      if (!settings) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      setZeroResults(false);
      setCancelled(false);
      setInterestsChanged(false);
      const activeTopics = onlyTopics
        ? settings.interests.filter((i) => onlyTopics.includes(i.topic))
        : settings.interests;
      setProgress({
        stage: "searching",
        message: "Starting agent…",
        perInterest: activeTopics.map((i) => ({
          topic: i.topic,
          state: "pending",
        })),
      });
      try {
        const next = await runAgent(settings, setProgress, {
          signal: controller.signal,
          onlyTopics,
        });
        saveLastBrief(next);
        setBrief(next);
        setProgress(null);
      } catch (e) {
        if (controller.signal.aborted) {
          setCancelled(true);
          setProgress(null);
        } else {
          const classified = classifyError(e);
          if (
            classified.kind === "unknown" &&
            (e as Error)?.name === "NoArticlesError"
          ) {
            setZeroResults(true);
          } else {
            setError(classified);
          }
          setProgress(null);
        }
      } finally {
        setRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [settings],
  );

  const generate = useCallback(() => runGeneration(), [runGeneration]);
  const retryFailedTopics = useCallback(
    (topics: string[]) => runGeneration(topics),
    [runGeneration],
  );

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
          initialStep={editing === "keys" ? 2 : 1}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            setEditing(null);
          }}
          onClearStoredKeys={() => {
            clearSettings();
            setSettings(null);
            setBrief(null);
            setEditing(null);
          }}
        />
        {settings && (
          <Button
            variant="link"
            size="sm"
            className="mt-3 self-start"
            onClick={() => setEditing(null)}
          >
            Cancel
          </Button>
        )}
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
          onEditInterests={() => setEditing("interests")}
        />
      )}

      <header className="flex flex-col gap-3 border-b border-border-default pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-caption uppercase text-muted">Notiva · MVP</p>
          <h1 className="text-title-1 text-primary">
            {settings.name}&apos;s brief
          </h1>
          <InterestChips
            interests={settings.interests}
            onChange={updateInterests}
          />
        </div>
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          <Button variant="secondary" onClick={() => setEditing("interests")}>
            Manage interests &amp; keys
          </Button>
          {companionReady && (
            <Button
              variant="secondary"
              loading={running}
              onClick={refreshViaCompanion}
              title="Use the local @notiva/agent companion"
            >
              {running ? "Working…" : "Refresh brief (companion)"}
            </Button>
          )}
          <Button variant="primary" loading={running} onClick={generate}>
            {running
              ? "Working…"
              : brief
                ? "Regenerate brief"
                : "Generate brief"}
          </Button>
        </div>
      </header>

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
              Regenerate brief now
            </Button>
          </span>
        </Banner>
      )}

      {progress && (
        <AgentProgressPanel progress={progress} onCancel={cancel} />
      )}

      {showSkeleton && <BriefSkeleton />}

      {cancelled && !running && <Banner tone="info">Cancelled.</Banner>}

      {error && (
        <ErrorBanner
          error={error}
          onRetry={generate}
          onEditKeys={() => setEditing("keys")}
        />
      )}

      {zeroResults && !running && (
        <EmptyState
          title="No articles found"
          body="Try broader interests or fewer constraints."
          primary={{
            label: "Edit interests",
            onClick: () => setEditing("interests"),
          }}
          secondary={{ label: "Try again", onClick: generate }}
        />
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
              onClick={() => retryFailedTopics(brief.failedTopics ?? [])}
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
          onEditInterests={() => setEditing("interests")}
        />
      ) : (
        !running &&
        !brief &&
        !zeroResults &&
        !error && (
          <div className="flex flex-col gap-3">
            <Banner tone="info">
              Example brief — click{" "}
              <span className="font-medium">Generate</span> to make your own.
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
            ← Notiva
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
          Notiva · brief
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
            {running ? "Working…" : "Regenerate brief"}
          </Button>
        </div>
      </div>
    </div>
  );
}
