"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";
import {
  bootstrapCompanionToken,
  COMPANION_PORT,
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
// The companion researches interests ONE AT A TIME (its own `claude` session
// per topic) — so the poll budget must scale with the interest count, not
// stay flat. A flat ~5 min budget (matching the main app path's old flat 300s
// deadline, PER-157) gave up on a still-healthy multi-topic run once PER-265's
// deeper per-paragraph detail bar lengthened real per-topic session time
// (PER-267): Generate showed a false "Timed out" and a retry hit the
// single-flight 409 — the "it doesn't work" go-around. Live measurement during
// the PER-267 investigation showed a real 6-topic run taking 32m40s wall-clock
// (research.ts's own hard per-session cap is 4 min, but this shared box runs
// several concurrent agent processes, so real scheduling jitter pushes well
// past the nominal per-session cap) — budget 6 min/topic for headroom over
// that observed number. See companion.ts refreshBriefViaCompanion for the
// mirrored calculation; keep both in sync.
const PER_TOPIC_SESSION_BUDGET_MS = 6 * 60 * 1000;
const MIN_POLL_ATTEMPTS = 75; // floor: ~5 min (75 × 4s), same headroom as before for a 1-2 topic run

export default function ConnectPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  // True once a pairing token is saved to storage — either auto-adopted from
  // the same-origin companion (`/v0/config`) or pasted manually. Tracked
  // separately from the editable `token` field so typing into the manual-paste
  // escape hatch doesn't flip `setupComplete`. Starts false so the first client
  // render matches the SSR/static export (no localStorage).
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [hasInterests, setHasInterests] = useState(false);
  // Resolve the tarball URL against the actual origin this page is served from,
  // so the copied command is correct regardless of the deploy host. Must START
  // at DEFAULT_TARBALL_URL so the first client render matches the SSR/static
  // export render (which has no `window`) — otherwise the differing command
  // text triggers a hydration mismatch (React #418). We swap in the real origin
  // in a post-mount effect, after hydration has reconciled.
  const [tarballUrl, setTarballUrl] = useState(DEFAULT_TARBALL_URL);
  const [status, setStatus] = useState<Status>("idle");
  const [copied, setCopied] = useState<string | null>(null);
  const [genState, setGenState] = useState<GenerateState>("idle");
  const [genMsg, setGenMsg] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const pollMaxAttemptsRef = useRef(MIN_POLL_ATTEMPTS);
  const startedAtRef = useRef("");

  useEffect(() => {
    // After hydration, resolve the tarball URL against the actual serving
    // origin so the copied install command points at this host. Doing this in
    // an effect (not a lazy initializer) keeps the first client render equal to
    // the SSR render — see the comment on `tarballUrl` above. Intentional
    // post-mount sync of a client-only value (the serving origin).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarballUrl(`${window.location.origin}${TARBALL_PATH}`);
    // Mirror saved interests so State A can surface a "set interests first"
    // link before the user clicks Generate. Read once on mount (post-hydration).
    setHasInterests((loadSettings()?.interests.length ?? 0) > 0);
  }, []);

  useEffect(() => {
    // When served from the companion (same-origin — loopback or a ts.net proxy),
    // auto-adopt the pairing token from /v0/config so the user skips copy/paste.
    (async () => {
      const tok = await bootstrapCompanionToken();
      setToken(tok);
      setHasSavedToken(Boolean(tok));
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
    setHasSavedToken(Boolean(token.trim()));
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
      setGenMsg("No interests set yet.");
      setGenState("error");
      return;
    }
    const tok = loadCompanionToken();
    if (!tok) {
      setGenMsg("No pairing token saved. Pair the companion first.");
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

    // Poll for the brief. Scale the attempt budget to how many topics this
    // run actually researches (sequential, one `claude` session each) so a
    // longer interest list gets real room instead of a flat 5-minute cap.
    const maxAttempts = Math.max(
      MIN_POLL_ATTEMPTS,
      Math.ceil(
        ((interests.length + 1) * PER_TOPIC_SESSION_BUDGET_MS) /
          POLL_INTERVAL_MS,
      ),
    );
    pollMaxAttemptsRef.current = maxAttempts;
    setGenState("polling");
    setGenMsg(
      `Waiting for brief… (up to ~${Math.round((maxAttempts * POLL_INTERVAL_MS) / 60_000)} min)`,
    );
    startedAtRef.current = new Date().toISOString();
    pollCountRef.current = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > pollMaxAttemptsRef.current) {
        clearInterval(pollRef.current!);
        setGenState("error");
        setGenMsg(
          "Timed out waiting for brief. Check the companion terminal for errors.",
        );
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

  // The page is only reachable at 127.0.0.1:47821 because the companion is
  // already installed, running, and paired — so when both are true, render the
  // "you're all set" success state instead of the install walkthrough. Same
  // semantics as `companionReady` in src/app/app/page.tsx.
  const setupComplete = status === "connected" && hasSavedToken;

  useEffect(() => {
    if (setupComplete) router.replace("/app/");
  }, [router, setupComplete]);

  // While the first ping is in flight we don't yet know which state to show.
  // Render a neutral placeholder rather than flashing the walkthrough and then
  // collapsing it (Doherty / perceived-performance — PER-140 spec §5).
  const resolving = status === "idle" || status === "checking";

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
      ? `✓ Connected · port ${COMPANION_PORT}`
      : status === "checking"
        ? "Checking…"
        : status === "disconnected"
          ? "Not running"
          : "—";

  // Install the prebuilt companion globally from the tarball URL, then use the
  // short `scout-agent` commands. No npm-registry account needed.
  const installCmd = `npm i -g ${tarballUrl}\nscout-agent pair`;
  const runCmd = "scout-agent run";

  const generateLabel =
    genState === "posting"
      ? "Sending interests…"
      : genState === "polling"
        ? "Generating brief…"
        : genState === "done"
          ? "Brief ready ✓"
          : "Generate brief with companion";

  const generating = genState === "posting" || genState === "polling";

  return (
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-xl space-y-8 px-5 py-10">
        <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
          <a href="/app" className="transition-colors hover:text-primary">
            ← Scout
          </a>
          <span className="flex items-center gap-3">
            <span>Pair the companion</span>
            {/* Persistent profile affordance across /app/* routes. */}
            <a
              href="/app/interests"
              aria-label="Open your profile"
              title="Profile & interests"
              className="inline-flex size-7 items-center justify-center rounded-pill border border-border-default text-muted transition-colors hover:text-primary"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
              </svg>
            </a>
          </span>
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

        {resolving ? (
          <CheckingPlaceholder />
        ) : setupComplete ? (
          /* ── State A — Connected: confirmation + Generate lead ── */
          <>
            <Banner tone="success">
              <div className="space-y-2">
                <p className="font-medium">You&apos;re all set</p>
                <CheckRow>Installed &amp; paired</CheckRow>
                <CheckRow>Companion running</CheckRow>
              </div>
            </Banner>

            <section className="space-y-3">
              <Button
                variant="primary"
                className="w-full"
                disabled={generating}
                loading={generating}
                onClick={handleGenerate}
              >
                {generateLabel}
              </Button>

              {!hasInterests && genState === "idle" && (
                <p className="text-sm text-secondary">
                  No interests set yet.{" "}
                  <a
                    href="/app"
                    className="text-signal underline underline-offset-2"
                  >
                    Set your interests first →
                  </a>
                </p>
              )}

              {genMsg && (
                <p
                  className={`text-sm ${
                    genState === "error"
                      ? "text-danger"
                      : genState === "done"
                        ? "text-success"
                        : "text-muted"
                  }`}
                >
                  {genMsg}
                  {genState === "error" && !hasInterests && (
                    <>
                      {" "}
                      <a
                        href="/app"
                        className="text-signal underline underline-offset-2"
                      >
                        Set your interests first →
                      </a>
                    </>
                  )}
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

            {/* Progressive disclosure — install reference for another machine */}
            <details className="group rounded-[6px] border border-border-default">
              <summary className="cursor-pointer rounded-[6px] px-4 py-3 font-mono text-[12px] uppercase tracking-[0.08em] text-muted outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
                Set Scout up on another machine
              </summary>
              <div className="space-y-5 border-t border-border-default px-4 py-4">
                <div className="space-y-2">
                  <p className="text-sm text-secondary">
                    Install &amp; pair on the other machine:
                  </p>
                  <CmdBlock
                    cmd={installCmd}
                    copyKey="pair"
                    copied={copied}
                    onCopy={copy}
                  />
                  <p className="text-xs text-muted">
                    Installs the prebuilt companion directly from this site.
                    Requires Node 20+.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-secondary">
                    Then start it (listens on port {COMPANION_PORT}):
                  </p>
                  <CmdBlock
                    cmd={runCmd}
                    copyKey="run"
                    copied={copied}
                    onCopy={copy}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-secondary">
                    Auto-pairing didn&apos;t work? Paste a token manually:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Paste pairing token here"
                      className="flex-1 rounded-[6px] border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring"
                    />
                    <Button variant="primary" onClick={handleSaveToken}>
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </details>
          </>
        ) : (
          /* ── State B — Walkthrough (github.io first-run, unchanged) ── */
          <>
            {/* Step 1 */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
                <span className="text-signal">01</span> Install &amp; pair
              </h2>
              <p className="text-sm text-secondary">
                Run this once in your terminal to install and generate a pairing
                token:
              </p>
              <CmdBlock
                cmd={installCmd}
                copyKey="pair"
                copied={copied}
                onCopy={copy}
              />
              <p className="text-xs text-muted">
                This installs the prebuilt companion package directly from this
                site. Requires Node 20+.
              </p>
              <p className="text-sm text-secondary">
                The command prints a token. Paste it below:
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste pairing token here"
                  className="flex-1 rounded-[6px] border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring"
                />
                <Button variant="primary" onClick={handleSaveToken}>
                  Save
                </Button>
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
              <CmdBlock
                cmd={runCmd}
                copyKey="run"
                copied={copied}
                onCopy={copy}
              />
              <p className="text-xs text-muted">
                Needs{" "}
                <code className="rounded bg-surface-muted px-1 font-mono text-[13px]">
                  claude
                </code>{" "}
                on your PATH, signed in to an account with WebSearch
                (anthropic.com Pro / Max). No third-party search key required.
              </p>
            </section>

            {/* Step 3 — Generate */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
                <span className="text-signal">03</span> Generate a brief
              </h2>
              <p className="text-sm text-secondary">
                With the companion running, click below to kick off a brief
                using your saved interests.
              </p>
              <Button
                variant="primary"
                className="w-full"
                disabled={status !== "connected" || generating}
                onClick={handleGenerate}
              >
                {generateLabel}
              </Button>
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
          </>
        )}
      </div>
    </main>
  );
}

function CheckRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-success">
      <span aria-hidden="true">✓</span>
      <span>{children}</span>
    </p>
  );
}

function CheckingPlaceholder() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-border-strong" />
      Checking companion…
    </div>
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
  // Header row keeps COPY out of the command's text lane entirely (PER-166) —
  // no absolute overlay overlapping the first line. The <pre> wraps long
  // unbreakable tokens (the install URL) instead of overflowing: `pre-wrap`
  // preserves the real newline between the two commands, `overflow-wrap:anywhere`
  // breaks the URL token, and `overflow-x-auto` stays only as a safety net.
  // The "Terminal" caption and COPY label live in separate DOM, so the copied
  // value is still the byte-for-byte `cmd` string.
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#322d25] bg-[#1c1a17]">
      <div className="flex items-center justify-between border-b border-[#322d25] pl-3 pr-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8b8474]">
          Terminal
        </span>
        <button
          type="button"
          onClick={() => onCopy(cmd, copyKey)}
          aria-label={copied === copyKey ? "Command copied" : "Copy command"}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-[#cabfa8] transition-colors hover:bg-[#322d25] hover:text-[#f1ece1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {copied === copyKey ? "copied!" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] px-4 py-3 font-mono text-sm text-[#f1ece1]">
        {cmd}
      </pre>
    </div>
  );
}
