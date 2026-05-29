"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bootstrapCompanionToken,
  COMPANION_PORT,
  isServedFromCompanion,
  loadCompanionToken,
  pingCompanion,
  pollBriefs,
  postInterests,
  saveCompanionToken,
} from "@/lib/companion";
import { loadSettings, saveLastBrief } from "@/lib/storage";

type Status = "idle" | "checking" | "connected" | "disconnected";
type GenerateState = "idle" | "posting" | "polling" | "done" | "error";

// We serve the prebuilt, zero-dependency companion tarball from this site
// (GitHub Pages) and install from the URL directly — works on a clean machine
// with no registry account.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const TARBALL_PATH = `${BASE_PATH}/agent/scout-agent-0.3.0.tgz`;
// Sensible absolute default for SSR/export; overwritten with the real origin
// after mount so the copied command is correct on whatever host serves it.
const DEFAULT_TARBALL_URL = `https://hakon1233.github.io${TARBALL_PATH}`;
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 20; // ~80s

export default function ConnectPage() {
  const [token, setToken] = useState("");
  // Resolve the tarball URL against the actual origin this page is served from,
  // so the copied command is correct regardless of the deploy host. Computed at
  // mount via a lazy initializer (falls back to the canonical URL during the
  // static export build, where `window` is undefined).
  const [tarballUrl] = useState(() =>
    typeof window !== "undefined"
      ? `${window.location.origin}${TARBALL_PATH}`
      : DEFAULT_TARBALL_URL,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [servedLocal, setServedLocal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [genState, setGenState] = useState<GenerateState>("idle");
  const [genMsg, setGenMsg] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const startedAtRef = useRef("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServedLocal(isServedFromCompanion());
    // When served from the companion (same-origin), auto-adopt the pairing
    // token from /v0/config so the user skips the copy/paste step entirely.
    (async () => {
      const tok = await bootstrapCompanionToken();
      setToken(tok);
    })();
  }, []);

  const check = useCallback(async () => {
    setStatus("checking");
    const ok = await pingCompanion();
    setStatus(ok ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
    intervalRef.current = setInterval(check, 8000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  const handleSaveToken = useCallback(() => {
    saveCompanionToken(token);
  }, [token]);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    const settings = loadSettings();
    if (!settings || settings.interests.length === 0) {
      setGenMsg("No interests set — go to the app page and add some interests first.");
      setGenState("error");
      return;
    }
    const tok = loadCompanionToken();
    if (!tok) {
      setGenMsg("No pairing token saved. Complete Step 1 first.");
      setGenState("error");
      return;
    }
    setGenState("posting");
    setGenMsg("");
    const interests = settings.interests.map((i) => i.topic);
    try {
      await postInterests(interests, tok);
    } catch (err) {
      setGenMsg(`Could not reach companion: ${String(err)}`);
      setGenState("error");
      return;
    }

    // Poll for the brief
    setGenState("polling");
    setGenMsg("Waiting for brief… (~60s)");
    startedAtRef.current = new Date().toISOString();
    pollCountRef.current = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > POLL_MAX_ATTEMPTS) {
        clearInterval(pollRef.current!);
        setGenState("error");
        setGenMsg("Timed out waiting for brief. Check the companion terminal for errors.");
        return;
      }
      try {
        const briefs = await pollBriefs(startedAtRef.current, tok);
        if (briefs.length > 0) {
          clearInterval(pollRef.current!);
          saveLastBrief(briefs[0]);
          setGenState("done");
          setGenMsg("Brief ready! Go to the app page to read it.");
        }
      } catch {
        // ignore transient errors, keep polling
      }
    }, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const statusColor =
    status === "connected"
      ? "text-green-600 dark:text-green-400"
      : status === "checking"
        ? "text-yellow-600 dark:text-yellow-400"
        : status === "disconnected"
          ? "text-red-500 dark:text-red-400"
          : "text-gray-400";

  const statusLabel =
    status === "connected"
      ? `Connected · port ${COMPANION_PORT}`
      : status === "checking"
        ? "Checking…"
        : status === "disconnected"
          ? "Not running"
          : "—";

  // Install the prebuilt companion globally from the tarball URL, then use the
  // short `scout-agent` commands. No npm-registry account needed.
  const installCmd = `npm i -g ${tarballUrl}\nscout-agent pair`;
  const runCmd = "scout-agent run";

  return (
    <main className="mx-auto max-w-xl px-5 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Connect your agent</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          The Scout companion runs on your laptop and uses your own{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">claude</code> CLI —
          web search goes through your Claude subscription, so no third-party search key is
          needed. Your Anthropic credentials never leave your machine.
        </p>
      </div>

      {/* Status pill */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            status === "connected"
              ? "bg-green-500"
              : status === "checking"
                ? "bg-yellow-500 animate-pulse"
                : status === "disconnected"
                  ? "bg-red-500"
                  : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
        <button
          onClick={check}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2"
        >
          refresh
        </button>
      </div>

      {/* Step 1 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Step 1 — Install &amp; pair
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Run this once in your terminal to install and generate a pairing token:
        </p>
        <CmdBlock cmd={installCmd} copyKey="pair" copied={copied} onCopy={copy} />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          This installs the prebuilt companion package directly from this site.
          Requires Node 20+.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The command prints a token. Paste it below:
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste pairing token here"
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSaveToken}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </section>

      {/* Step 2 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Step 2 — Start the companion
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Keep this running in a terminal tab. It listens on port {COMPANION_PORT}.
        </p>
        <CmdBlock cmd={runCmd} copyKey="run" copied={copied} onCopy={copy} />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Needs{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">claude</code>{" "}
          on your PATH, signed in to an account with WebSearch (anthropic.com Pro / Max).
          No third-party search key required.
        </p>
      </section>

      {/* Step 3 — Generate */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Step 3 — Generate a brief
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          With the companion running, click below to kick off a brief using your saved interests.
        </p>
        <button
          disabled={status !== "connected" || genState === "posting" || genState === "polling"}
          onClick={handleGenerate}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {genState === "posting"
            ? "Sending interests…"
            : genState === "polling"
              ? "Generating brief…"
              : genState === "done"
                ? "Brief ready ✓"
                : "Generate brief with companion"}
        </button>
        {genMsg && (
          <p
            className={`text-sm ${genState === "error" ? "text-red-500" : genState === "done" ? "text-green-600 dark:text-green-400" : "text-gray-500"}`}
          >
            {genMsg}
            {genState === "done" && (
              <>
                {" "}
                <a
                  href="/app"
                  className="underline underline-offset-2 text-blue-600 dark:text-blue-400"
                >
                  Go to brief →
                </a>
              </>
            )}
          </p>
        )}
      </section>
    </main>
  );
}

function CmdBlock({
  cmd,
  copyKey,
  copied,
  onCopy,
}: {
  cmd: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="relative rounded-lg bg-gray-900 dark:bg-gray-950 border border-gray-800">
      <pre className="px-4 py-3 text-sm text-gray-100 font-mono overflow-x-auto whitespace-pre">
        {cmd}
      </pre>
      <button
        onClick={() => onCopy(cmd, copyKey)}
        className="absolute top-2 right-2 px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
      >
        {copied === copyKey ? "copied!" : "copy"}
      </button>
    </div>
  );
}
