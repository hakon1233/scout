"use client";

import { useEffect } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AppShell } from "@/components/shell/AppShell";
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
    <AppShell>
      <section>
        <div className="w-full">
          <ErrorBanner
            error={{
              ...classified,
              message:
                "Scout hit an unexpected rendering error. Your saved brief and settings are still safe.",
            }}
            onRetry={unstable_retry}
          />
        </div>
      </section>
    </AppShell>
  );
}
