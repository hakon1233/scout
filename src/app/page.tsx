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
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Hello, world — the deploy pipeline works. Product is on the way.
        </p>
      </div>
    </main>
  );
}
