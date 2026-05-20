import Link from "next/link";

const primaryLinkClasses =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 py-2.5 text-body-sm font-medium text-accent-fg shadow-sm transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page";

const secondaryLinkClasses =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-5 py-2.5 text-body-sm font-medium text-primary transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-16 font-sans text-primary sm:px-6 sm:py-24">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <p className="text-caption font-medium uppercase text-muted">Notiva</p>
        <h1 className="text-display text-primary">
          Personalized news, delivered by agents.
        </h1>
        <p className="max-w-xl text-body text-secondary">
          Set your interests once. Our agents read the web and deliver a brief
          with only the news you care about.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/app" className={primaryLinkClasses}>
            Open the app
          </Link>
          <a
            href="https://github.com/hakon1233/notiva"
            target="_blank"
            rel="noreferrer"
            className={secondaryLinkClasses}
          >
            View on GitHub
          </a>
        </div>
        <p className="text-caption text-muted">
          MVP runs entirely in your browser with your own Anthropic and Exa API
          keys. Hosted Supabase backend is the next milestone.
        </p>
      </div>
    </main>
  );
}
