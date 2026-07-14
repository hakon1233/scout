export type ScoutErrorKind = "auth" | "rate_limit" | "network" | "unknown";
export type ScoutErrorProvider = "anthropic" | "exa" | "app";

export class ScoutError extends Error {
  kind: ScoutErrorKind;
  provider: ScoutErrorProvider;
  retryAfterSec?: number;
  cause?: unknown;

  constructor(opts: {
    kind: ScoutErrorKind;
    provider: ScoutErrorProvider;
    message: string;
    retryAfterSec?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "ScoutError";
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.retryAfterSec = opts.retryAfterSec;
    this.cause = opts.cause;
  }
}

export type ClassifiedError = {
  kind: ScoutErrorKind;
  provider: ScoutErrorProvider;
  message: string;
  retryAfterSec?: number;
  raw: string;
};

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ScoutError) {
    return {
      kind: err.kind,
      provider: err.provider,
      message: err.message,
      retryAfterSec: err.retryAfterSec,
      raw: stackOrMessage(err),
    };
  }
  const e = err as Error & { name?: string };
  if (e?.name === "AbortError") {
    return {
      kind: "network",
      provider: "app",
      message: "Cancelled.",
      raw: stackOrMessage(err),
    };
  }
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError"
  // (NOT "AbortError"), and its message ("signal timed out") doesn't match the
  // network keyword test below — so companion fetch timeouts used to fall
  // through to "unknown" and miss the network-provider banner treatment. A
  // timeout IS a network condition, but it wasn't user-cancelled, so it gets its
  // own message rather than "Cancelled." (AIR-107).
  if (e?.name === "TimeoutError") {
    return {
      kind: "network",
      provider: "app",
      message: "That took too long — check the companion is running and retry.",
      raw: stackOrMessage(err),
    };
  }
  const msg = e?.message ?? String(err);
  if (/network|fetch|reach|connect/i.test(msg)) {
    return {
      kind: "network",
      provider: "app",
      message: msg,
      raw: stackOrMessage(err),
    };
  }
  return {
    kind: "unknown",
    provider: "app",
    message: msg,
    raw: stackOrMessage(err),
  };
}

/**
 * Read a companion error response body, tolerating non-JSON payloads.
 * Centralises the `await res.json().catch(...)` parse+cast that was duplicated
 * across every companion/chat fetch helper. Callers keep their own
 * `?? fallback` so messaging stays per-call-site (behaviour-preserving).
 */
export async function readErrorBody(
  res: Response,
): Promise<{ error?: string; hint?: string }> {
  return (await res.json().catch(() => ({ error: res.statusText }))) as {
    error?: string;
    hint?: string;
  };
}

function stackOrMessage(err: unknown): string {
  const e = err as Error;
  return e?.stack ?? e?.message ?? String(err);
}
