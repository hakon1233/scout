import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-24 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Notiva
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Personalized news, delivered by agents.
        </h1>
        <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Set your interests once. Our agents read the web and deliver a brief
          with only the news you care about.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/app"
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Open the app
          </Link>
          <a
            href="https://github.com/hakon1233/notiva"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            View on GitHub
          </a>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          MVP runs entirely in your browser with your own Anthropic and Exa API
          keys. Hosted Supabase backend is the next milestone.
        </p>
      </div>
    </main>
  );
}
