"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentProgressPanel } from "@/components/AgentProgressPanel";
import { BriefLayout } from "@/components/BriefLayout";
import { BriefSkeleton } from "@/components/BriefSkeleton";
import { SetupForm } from "@/components/SetupForm";
import { Banner, Button, Card } from "@/components/ui";
import { runAgent, type AgentProgress } from "@/lib/agent";
import {
  loadLastBrief,
  loadSettings,
  saveLastBrief,
  saveSettings,
} from "@/lib/storage";
import type { Brief, Settings } from "@/lib/types";

const STICKY_THRESHOLD_PX = 480;

export default function AppPage() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
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

  const generate = useCallback(async () => {
    if (!settings) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setCancelled(false);
    setProgress({
      stage: "searching",
      message: "Starting agent…",
      perInterest: settings.interests.map((i) => ({
        topic: i.topic,
        state: "pending",
      })),
    });
    try {
      const next = await runAgent(settings, setProgress, {
        signal: controller.signal,
      });
      saveLastBrief(next);
      setBrief(next);
      setProgress(null);
    } catch (e) {
      if (controller.signal.aborted) {
        setCancelled(true);
        setProgress(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setProgress(null);
      }
    } finally {
      setRunning(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [settings]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (!hydrated) {
    return (
      <Shell>
        <p className="text-body-sm text-muted">Loading…</p>
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
          }}
        />
        {settings && (
          <Button
            variant="link"
            size="sm"
            className="mt-3 self-start"
            onClick={() => setEditing(false)}
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
          onEditInterests={() => setEditing(true)}
        />
      )}

      <header className="flex flex-col gap-3 border-b border-border-default pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-caption uppercase text-muted">Notiva · MVP</p>
          <h1 className="text-title-1 text-primary">
            {settings.name}&apos;s brief
          </h1>
          <p className="mt-1 break-words text-caption text-muted">
            Topics: {settings.interests.map((i) => i.topic).join(", ")}
          </p>
        </div>
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit interests
          </Button>
          <Button variant="primary" loading={running} onClick={generate}>
            {running
              ? "Working…"
              : brief
                ? "Regenerate brief"
                : "Generate brief"}
          </Button>
        </div>
      </header>

      {progress && (
        <AgentProgressPanel progress={progress} onCancel={cancel} />
      )}

      {showSkeleton && <BriefSkeleton />}

      {cancelled && !running && <Banner tone="info">Cancelled.</Banner>}

      {error && <Banner tone="danger">{error}</Banner>}

      {brief && !showSkeleton ? (
        <BriefLayout
          brief={brief}
          name={settings.name}
          running={running}
          onRegenerate={generate}
          onEditInterests={() => setEditing(true)}
        />
      ) : (
        !running &&
        !brief && (
          <Card tone="dashed" padding="lg" className="text-center">
            <p className="text-body-sm text-muted">
              No brief yet. Click{" "}
              <span className="font-medium text-primary">Generate brief</span>{" "}
              to run the agent on your topics.
            </p>
          </Card>
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
            Edit interests
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
