export type NotivaErrorKind = "auth" | "rate_limit" | "network" | "unknown";
export type NotivaErrorProvider = "anthropic" | "exa" | "app";

export class NotivaError extends Error {
  kind: NotivaErrorKind;
  provider: NotivaErrorProvider;
  retryAfterSec?: number;
  cause?: unknown;

  constructor(opts: {
    kind: NotivaErrorKind;
    provider: NotivaErrorProvider;
    message: string;
    retryAfterSec?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "NotivaError";
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.retryAfterSec = opts.retryAfterSec;
    this.cause = opts.cause;
  }
}

export type ClassifiedError = {
  kind: NotivaErrorKind;
  provider: NotivaErrorProvider;
  message: string;
  retryAfterSec?: number;
  raw: string;
};

export function fromHttp(
  provider: NotivaErrorProvider,
  status: number,
  body: string,
  retryAfter?: string | null,
): NotivaError {
  const trimmedBody = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return new NotivaError({
      kind: "auth",
      provider,
      message: `${providerLabel(provider)} ${status}: ${trimmedBody}`,
    });
  }
  if (status === 429 || status === 529) {
    return new NotivaError({
      kind: "rate_limit",
      provider,
      retryAfterSec: parseRetryAfter(retryAfter),
      message: `${providerLabel(provider)} ${status}: ${trimmedBody}`,
    });
  }
  return new NotivaError({
    kind: "unknown",
    provider,
    message: `${providerLabel(provider)} ${status}: ${trimmedBody}`,
  });
}

export function fromTransport(
  provider: NotivaErrorProvider,
  err: unknown,
): NotivaError {
  const e = err as Error & { name?: string; code?: string };
  if (e?.name === "AbortError") {
    return new NotivaError({
      kind: "network",
      provider,
      message: `${providerLabel(provider)} request timed out or was cancelled.`,
      cause: err,
    });
  }
  return new NotivaError({
    kind: "network",
    provider,
    message: `${providerLabel(provider)} unreachable: ${
      e?.message ?? String(err)
    }`,
    cause: err,
  });
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof NotivaError) {
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

function providerLabel(p: NotivaErrorProvider): string {
  switch (p) {
    case "anthropic":
      return "Anthropic";
    case "exa":
      return "Exa";
    case "app":
      return "App";
  }
}

function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 300);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const sec = Math.round((dateMs - Date.now()) / 1000);
    if (sec > 0) return Math.min(sec, 300);
  }
  return undefined;
}

function stackOrMessage(err: unknown): string {
  const e = err as Error;
  return e?.stack ?? e?.message ?? String(err);
}
