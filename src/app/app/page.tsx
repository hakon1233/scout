"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BriefView } from "@/components/BriefView";
import { SetupForm } from "@/components/SetupForm";
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
        <p className="text-sm text-zinc-500">Loading…</p>
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
          <button
            type="button"
            className="mt-3 self-start text-sm text-zinc-500 underline"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">
            Notiva · MVP
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {settings.name}&apos;s brief
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Topics: {settings.interests.map((i) => i.topic).join(", ")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            onClick={() => setEditing(true)}
          >
            Edit interests
          </button>
          <button
            type="button"
            disabled={running}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            onClick={generate}
          >
            {running ? "Working…" : brief ? "Regenerate brief" : "Generate brief"}
          </button>
        </div>
      </header>

      {progress && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="font-medium">
            {progress.stage === "searching"
              ? "Searching"
              : progress.stage === "synthesizing"
                ? "Synthesizing"
                : "…"}
            :
          </span>{" "}
          {progress.message}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {brief ? (
        <BriefView brief={brief} />
      ) : (
        !running && (
          <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No brief yet. Click <span className="font-medium">Generate brief</span>{" "}
            to run the agent on your topics.
          </div>
        )
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-12 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <nav className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Notiva
          </Link>
        </nav>
        {children}
      </div>
    </main>
  );
}
