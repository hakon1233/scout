"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BriefView } from "@/components/BriefView";
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

export default function AppPage() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function generate() {
    if (!settings) return;
    setRunning(true);
    setError(null);
    setProgress({ stage: "searching", message: "Starting agent…" });
    try {
      const next = await runAgent(settings, setProgress);
      saveLastBrief(next);
      setBrief(next);
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Shell>
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
        <Card tone="muted" padding="sm">
          <span className="font-medium text-primary">
            {progress.stage === "searching"
              ? "Searching"
              : progress.stage === "synthesizing"
                ? "Synthesizing"
                : "…"}
            :
          </span>{" "}
          <span className="text-secondary">{progress.message}</span>
        </Card>
      )}

      {error && <Banner tone="danger">{error}</Banner>}

      {brief ? (
        <BriefView brief={brief} />
      ) : (
        !running && (
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
