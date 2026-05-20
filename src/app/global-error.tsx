"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-24 font-sans text-primary">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <h1 className="text-title-1 text-primary">Something went wrong</h1>
          <p className="text-secondary">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="w-fit rounded-pill bg-accent px-5 py-2 text-body-sm font-medium text-accent-fg"
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
