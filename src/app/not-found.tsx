import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-24 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          404
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          That page does not exist yet. Head back to{" "}
          <Link className="underline" href="/">
            the home page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
