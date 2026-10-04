"use client";

import { Banner, Button } from "@/components/ui";
import type { ClassifiedError } from "@/lib/errors";

type Props = {
  error: ClassifiedError;
  onRetry: () => void;
};

export function ErrorBanner({ error, onRetry }: Props) {
  if (error.kind === "network") {
    return (
      <Banner tone="warning">
        <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Couldn&apos;t reach Scout. Check your connection.</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      </Banner>
    );
  }

  return (
    <Banner tone="danger">
      <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <span className="break-words">{error.message}</span>
        <span className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void copyToClipboard(formatDetails(error));
            }}
          >
            Copy details
          </Button>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      </span>
    </Banner>
  );
}

function formatDetails(e: ClassifiedError): string {
  return [`Scout error`, `kind: ${e.kind}`, `message: ${e.message}`, "", e.raw]
    .filter(Boolean)
    .join("\n");
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to textarea fallback
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
