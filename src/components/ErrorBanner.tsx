"use client";

import * as React from "react";
import { Banner, Button } from "@/components/ui";
import type { ClassifiedError, ScoutErrorProvider } from "@/lib/errors";

type Props = {
  error: ClassifiedError;
  onRetry: () => void;
};

const providerLabel: Record<ScoutErrorProvider, string> = {
  anthropic: "Anthropic",
  exa: "Exa",
  app: "Scout",
};

export function ErrorBanner({ error, onRetry }: Props) {
  // Brief generation runs only through the local companion now (PER-109), so
  // there are no BYO keys to edit. An auth failure here means the companion
  // token was rejected — re-pairing is the fix.
  if (error.kind === "auth") {
    return (
      <Banner tone="danger">
        <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Scout couldn&apos;t authenticate with its companion. Restart{" "}
            <code className="font-mono text-mono-xs">scout-agent run</code> and
            reconnect from{" "}
            <code className="font-mono text-mono-xs">/app/connect</code>.
          </span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      </Banner>
    );
  }

  if (error.kind === "rate_limit") {
    return (
      <Banner tone="warning">
        <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Hit the {providerLabel[error.provider]} rate limit. Wait a minute
            and try again.
            {typeof error.retryAfterSec === "number" && (
              <RetryCountdown seconds={error.retryAfterSec} />
            )}
          </span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      </Banner>
    );
  }

  if (error.kind === "network") {
    return (
      <Banner tone="warning">
        <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Couldn&apos;t reach {providerLabel[error.provider]}. Check your
            connection.
          </span>
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

function RetryCountdown({ seconds }: { seconds: number }) {
  const [deadline] = React.useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (left <= 0) return null;
  return <span className="ml-1 tabular-nums text-muted">(~{left}s)</span>;
}

function formatDetails(e: ClassifiedError): string {
  return [
    `Scout error`,
    `kind: ${e.kind}`,
    `provider: ${e.provider}`,
    `message: ${e.message}`,
    e.retryAfterSec ? `retryAfter: ${e.retryAfterSec}s` : null,
    "",
    e.raw,
  ]
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
