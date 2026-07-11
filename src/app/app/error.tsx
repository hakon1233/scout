"use client";

import { useEffect } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AppNav } from "@/components/AppNav";
import { classifyError } from "@/lib/errors";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const classified = classifyError(error);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
      <AppNav />
      <section className="flex flex-1 items-center">
        <div className="w-full">
          <ErrorBanner
            error={{
              ...classified,
              provider: "app",
              message:
                "Scout hit an unexpected rendering error. Your saved brief and settings are still safe.",
            }}
            onRetry={unstable_retry}
          />
        </div>
      </section>
    </main>
  );
}
