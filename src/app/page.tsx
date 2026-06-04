import Link from "next/link";
import { PairedEntryRedirect } from "@/components/PairedEntryRedirect";
import { ThemeToggle } from "@/components/ThemeToggle";

// Direction A — Editorial / "Private Wire Service" (PER-114, founder pick).
// Masthead → hero (with sample brief filed alongside) → how-it-works →
// closing → colophon footer. Warm-paper canvas, ink type, signal-red dateline.

const steps = [
  {
    n: "01",
    title: "Pick your interests",
    body: "Tell Scout the topics, beats, and questions you actually care about — in plain language.",
  },
  {
    n: "02",
    title: "Agents fetch & read",
    body: "Agents search the web in parallel, dedupe the noise, and read the sources behind every story.",
  },
  {
    n: "03",
    title: "Your brief is filed",
    body: "One clean, editorial brief lands — only the news that matches what you asked for.",
  },
];

const briefSections = [
  {
    heading: "AI agents",
    items: [
      {
        lead: "Anthropic tightens reliability framework.",
        rest: "New eval suite targets tool-use agents; early prompt-injection rates fall.",
      },
      {
        lead: "OpenAI opens browser-using agent to general preview,",
        rest: "widening the door to broader real-world tasks.",
      },
    ],
  },
  {
    heading: "Climate tech",
    items: [
      {
        lead: "Direct-air-capture pilot",
        rest: "claims sub-$200/ton at a Texas demo plant.",
      },
      {
        lead: "EU passes long-duration storage subsidy,",
        rest: "reshaping battery and thermal projects.",
      },
    ],
  },
  {
    heading: "Norwegian football",
    items: [
      {
        lead: "Bodø/Glimt edge through to the Europa League quarter-finals",
        rest: "on aggregate.",
      },
    ],
  },
];

function CompassMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative grid size-[34px] place-items-center rounded-full border-2 border-primary ${className}`}
    >
      <span className="size-[10px] rounded-full border-2 border-primary" />
      <span className="absolute top-1 h-[13px] w-[2px] rotate-[35deg] bg-signal" />
    </span>
  );
}

const navLink =
  "text-secondary transition-colors hover:text-primary no-underline";

export default function Home() {
  return (
    <main className="min-h-screen bg-page font-sans text-primary">
      <PairedEntryRedirect />
      {/* Masthead */}
      <header className="border-b-[1.5px] border-primary">
        <div className="mx-auto w-full max-w-[1120px] px-7">
          <div className="flex items-center justify-between py-3 font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
            <span className="flex items-center gap-2">
              <span className="inline-block size-1.5 rounded-full bg-signal" />
              Your private wire
            </span>
            <span className="hidden sm:inline">Vol. 1</span>
          </div>
          <div className="flex items-end justify-between pb-4 pt-1.5">
            <div className="flex items-center gap-3 font-serif text-[40px] font-semibold leading-none tracking-[-0.02em]">
              <CompassMark />
              Scout
            </div>
            <nav className="hidden items-center gap-7 text-[14px] lg:flex">
              <a href="#how-it-works" className={navLink}>
                How it works
              </a>
              <a href="#privacy" className={navLink}>
                Privacy
              </a>
              <a
                href="https://github.com/hakon1233/scout"
                target="_blank"
                rel="noreferrer"
                className={navLink}
              >
                GitHub
              </a>
              <Link
                href="/app"
                className="font-medium text-primary no-underline transition-opacity hover:opacity-80"
              >
                Open the app →
              </Link>
              <ThemeToggle />
            </nav>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1120px] px-7">
        {/* Hero */}
        <section className="grid items-start gap-9 py-9 lg:grid-cols-[1.05fr_0.95fr] lg:gap-[54px] lg:py-14">
          <div>
            <p className="mb-5 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
              <span className="h-[1.5px] w-[26px] bg-signal" />
              Personalized intelligence
            </p>
            <h1 className="mb-5 font-serif text-[42px] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-[52px] lg:text-[62px]">
              The news that matters to you,{" "}
              <em className="italic text-signal">written</em> by agents.
            </h1>
            <p className="mb-7 max-w-[30em] font-reading text-[21px] leading-[1.5] text-secondary">
              Set your interests once. Scout&apos;s agents read the open web,
              dedupe the noise, and file one clean editorial brief — only the
              stories you asked for.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-[6px] bg-accent px-[26px] py-[14px] text-[15px] font-medium text-accent-fg no-underline transition-colors hover:bg-accent-hover"
              >
                Open the app →
              </Link>
              <a
                href="#how-it-works"
                className="text-[14px] text-secondary no-underline transition-colors hover:text-primary"
              >
                How it works
              </a>
            </div>
            <div
              id="privacy"
              className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted"
            >
              <span className="flex items-center gap-2">
                <ShieldIcon />
                Local-first &amp; private
              </span>
              <span className="flex items-center gap-2">
                <ForkIcon />
                Bring your own model
              </span>
              <span className="flex items-center gap-2">
                <NoTrackIcon />
                No tracking, no inbox spam
              </span>
            </div>
          </div>

          {/* Sample brief, filed alongside */}
          <aside
            id="sample"
            aria-label="Sample brief preview"
            className="overflow-hidden rounded-lg border border-border-default bg-paper-card shadow-[0_1px_0_var(--line),0_18px_40px_-22px_rgba(28,26,23,0.4)]"
          >
            <div className="border-b border-border-default px-[22px] pb-3.5 pt-[18px]">
              <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                <span>Your brief</span>
                <span>May 31, 2026</span>
              </div>
              <div className="mt-2 font-serif text-[24px] font-semibold tracking-[-0.01em]">
                Good morning, Alex.
              </div>
            </div>
            <div className="px-[22px] pb-5 pt-1.5">
              {briefSections.map((section) => (
                <div
                  key={section.heading}
                  className="border-b border-border-strong/40 py-4 last:border-b-0"
                >
                  <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
                    {section.heading}
                  </div>
                  {section.items.map((item, i) => (
                    <p
                      key={i}
                      className="relative mb-2.5 pl-4 font-reading text-[15.5px] leading-[1.45] text-secondary last:mb-0 before:absolute before:left-0 before:top-[9px] before:size-[5px] before:rounded-full before:bg-border-strong"
                    >
                      <b className="font-sans text-[14.5px] font-semibold text-primary">
                        {item.lead}
                      </b>{" "}
                      {item.rest}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-10 lg:py-16">
          <div className="mb-9 flex items-baseline justify-between border-b border-border-default pb-3.5">
            <h2 className="font-serif text-[26px] font-semibold tracking-[-0.02em] sm:text-[34px]">
              From interests to brief, in three moves.
            </h2>
            <span className="hidden font-mono text-[12px] uppercase tracking-[0.1em] text-muted sm:inline">
              How it works
            </span>
          </div>
          <div className="grid gap-6 sm:grid-cols-3 sm:gap-0">
            {steps.map((step, i) => (
              <div
                key={step.n}
                className={
                  i === 0
                    ? "sm:pr-[30px]"
                    : "border-t border-border-default pt-5 sm:border-l sm:border-t-0 sm:px-[30px] sm:pt-0"
                }
              >
                <div className="mb-4 font-serif text-[42px] font-medium leading-none text-signal">
                  {step.n}
                </div>
                <h3 className="mb-2 text-[18px] font-semibold tracking-[-0.01em]">
                  {step.title}
                </h3>
                <p className="font-reading text-[16px] leading-[1.5] text-secondary">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing */}
        <section className="mt-2 flex flex-col items-start gap-7 rounded-[10px] bg-accent px-8 py-12 text-accent-fg sm:flex-row sm:items-center sm:justify-between sm:px-11">
          <div>
            <h2 className="font-serif text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[32px]">
              Your own wire service.
              <br />
              Filed every morning.
            </h2>
            <p className="mt-2 font-reading text-[17px] text-accent-fg/70">
              Runs as a loopback companion to your local Claude Code CLI. No
              extra keys, nothing leaves your machine.
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex shrink-0 items-center gap-2 rounded-[6px] bg-page px-[22px] py-[13px] text-[15px] font-medium text-primary no-underline transition-opacity hover:opacity-90"
          >
            Open the app →
          </Link>
        </section>
      </div>

      {/* Colophon */}
      <footer className="mx-auto mt-8 flex w-full max-w-[1120px] flex-col gap-2 border-t border-border-default px-7 py-9 font-mono text-[13px] tracking-[0.04em] text-muted sm:flex-row sm:justify-between">
        <span>Scout · Personalized news by agents</span>
        <span>Local-first · Open source · 2026</span>
      </footer>
    </main>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="size-[15px] text-signal-deep"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg
      className="size-[15px] text-signal-deep"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

function NoTrackIcon() {
  return (
    <svg
      className="size-[15px] text-signal-deep"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
