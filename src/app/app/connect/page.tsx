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
      ? "text-success"
      : status === "checking"
        ? "text-warning"
        : status === "disconnected"
          ? "text-danger"
          : "text-muted";

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
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-xl space-y-8 px-5 py-10">
        <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
          <a
            href="/app"
            className="transition-colors hover:text-primary"
          >
            ← Scout
          </a>
          <span>Pair the companion</span>
        </div>

        <div>
          <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
            <span className="h-[1.5px] w-[26px] bg-signal" />
            Set up your wire
          </p>
          <h1 className="mb-2 font-serif text-[34px] font-semibold tracking-[-0.02em]">
            Connect your agent
          </h1>
          <p className="font-reading text-[17px] leading-relaxed text-secondary">
            The Scout companion runs on your laptop and uses your own{" "}
            <code className="rounded bg-surface-muted px-1 font-mono text-[13px]">
              claude
            </code>{" "}
            CLI — web search goes through your Claude subscription, so no
            third-party search key is needed. Your Anthropic credentials never
            leave your machine.
          </p>
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-2 border-y border-border-default py-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-success"
                : status === "checking"
                  ? "animate-pulse bg-warning"
                  : status === "disconnected"
                    ? "bg-signal"
                    : "bg-border-strong"
            }`}
          />
          <span className={`text-sm font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          <button
            onClick={check}
            className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted underline underline-offset-2 transition-colors hover:text-primary"
          >
            refresh
          </button>
        </div>

        {/* Step 1 */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            <span className="text-signal">01</span> Install &amp; pair
          </h2>
          <p className="text-sm text-secondary">
            Run this once in your terminal to install and generate a pairing
            token:
          </p>
          <CmdBlock cmd={installCmd} copyKey="pair" copied={copied} onCopy={copy} />
          <p className="text-xs text-muted">
            This installs the prebuilt companion package directly from this
            site. Requires Node 20+.
          </p>
          <p className="text-sm text-secondary">
            The command prints a token. Paste it below:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste pairing token here"
              className="flex-1 rounded-[6px] border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <button
              onClick={handleSaveToken}
              className="rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Save
            </button>
          </div>
        </section>

        {/* Step 2 */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            <span className="text-signal">02</span> Start the companion
          </h2>
          <p className="text-sm text-secondary">
            Keep this running in a terminal tab. It listens on port{" "}
            {COMPANION_PORT}.
          </p>
          <CmdBlock cmd={runCmd} copyKey="run" copied={copied} onCopy={copy} />
          <p className="text-xs text-muted">
            Needs{" "}
            <code className="rounded bg-surface-muted px-1 font-mono text-[13px]">
              claude
            </code>{" "}
            on your PATH, signed in to an account with WebSearch (anthropic.com
            Pro / Max). No third-party search key required.
          </p>
        </section>

        {/* Step 3 — Generate */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            <span className="text-signal">03</span> Generate a brief
          </h2>
          <p className="text-sm text-secondary">
            With the companion running, click below to kick off a brief using
            your saved interests.
          </p>
          <button
            disabled={status !== "connected" || genState === "posting" || genState === "polling"}
            onClick={handleGenerate}
            className="w-full rounded-[6px] bg-accent py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
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
              className={`text-sm ${genState === "error" ? "text-danger" : genState === "done" ? "text-success" : "text-muted"}`}
            >
              {genMsg}
              {genState === "done" && (
                <>
                  {" "}
                  <a
                    href="/app"
                    className="text-signal underline underline-offset-2"
                  >
                    Go to brief →
                  </a>
                </>
              )}
            </p>
          )}
        </section>
      </div>
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
    <div className="relative rounded-[6px] border border-[#322d25] bg-[#1c1a17]">
      <pre className="overflow-x-auto whitespace-pre px-4 py-3 font-mono text-sm text-[#f1ece1]">
        {cmd}
      </pre>
      <button
        onClick={() => onCopy(cmd, copyKey)}
        className="absolute right-2 top-2 rounded px-2 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[#9a917f] transition-colors hover:bg-[#322d25] hover:text-[#f1ece1]"
      >
        {copied === copyKey ? "copied!" : "copy"}
      </button>
    </div>
  );
}
