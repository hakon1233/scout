import Link from "next/link";
import { BriefLayout } from "@/components/BriefLayout";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, buttonClasses } from "@/components/ui";
import { SAMPLE_BRIEF } from "@/lib/sample-brief";

const steps = [
  {
    n: "1",
    title: "Pick interests",
    body: "Tell Scout the topics, beats, and questions you actually care about.",
  },
  {
    n: "2",
    title: "Agents fetch",
    body: "Agents search the web in parallel, dedupe, and read the sources behind each story.",
  },
  {
    n: "3",
    title: "Brief arrives",
    body: "You get one clean, editorial brief — only the news that matches what you asked for.",
  },
];

export default function Home() {
  return (
    <main className="relative min-h-screen bg-page font-sans text-primary">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-20 pb-16 sm:px-6 sm:pt-24 lg:grid lg:grid-cols-12 lg:gap-10 lg:pt-28">
        <div className="flex flex-col gap-6 lg:col-span-7 lg:justify-center">
          <p className="text-caption font-medium uppercase text-muted">
            Scout
          </p>
          <h1 className="text-display text-primary">
            Personalized news, delivered by agents.
          </h1>
          <p className="max-w-xl text-body text-secondary">
            Set your interests once. Our agents read the web and deliver a
            brief with only the news you care about.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href="/app"
              className={`${buttonClasses("primary", "md")} w-full sm:w-auto`}
            >
              Open the app
            </Link>
            <a
              href="https://github.com/hakon1233/scout"
              target="_blank"
              rel="noreferrer"
              className={`${buttonClasses("ghost", "md")} w-full sm:w-auto`}
            >
              View on GitHub
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center px-1 py-2 text-body-sm font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              How it works
            </a>
          </div>
          <p className="text-caption text-muted">
            MVP runs as a loopback companion to your local Claude Code CLI —
            agents search and fetch the web through Claude Code&apos;s built-in
            tools. No extra API keys required.
          </p>
        </div>

        <div className="mt-6 lg:col-span-5 lg:mt-0">
          <Card
            tone="default"
            padding="lg"
            aria-label="Sample brief preview"
            className="overflow-hidden"
          >
            <BriefLayout
              brief={SAMPLE_BRIEF}
              name="Alex"
              preview
            />
          </Card>
        </div>
      </section>

      <section
        id="how-it-works"
        className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6"
      >
        <div className="flex flex-col gap-2 pb-8">
          <p className="text-caption font-medium uppercase text-muted">
            How it works
          </p>
          <h2 className="text-title-1 text-primary">
            From interests to brief in three steps.
          </h2>
        </div>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step) => (
            <li key={step.n}>
              <Card tone="default" padding="lg" className="flex h-full flex-col gap-3">
                <span className="inline-flex size-8 items-center justify-center rounded-pill bg-surface-muted text-body-sm font-medium text-muted">
                  {step.n}
                </span>
                <h3 className="text-title-3 text-primary">{step.title}</h3>
                <p className="text-body-sm text-secondary">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
