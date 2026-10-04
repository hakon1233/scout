export type ClassifiedError = {
  kind: "network" | "unknown";
  message: string;
  raw: string;
};

export function classifyError(err: unknown): ClassifiedError {
  const e = err as Error & { name?: string };
  if (e?.name === "AbortError") {
    return {
      kind: "network",
      message: "Cancelled.",
      raw: stackOrMessage(err),
    };
  }
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError"
  // (NOT "AbortError"), and its message ("signal timed out") doesn't match the
  // network keyword test below — so companion fetch timeouts used to fall
  // through to "unknown" and miss the network banner. A
  // timeout IS a network condition, but it wasn't user-cancelled, so it gets its
  // own message rather than "Cancelled."
  if (e?.name === "TimeoutError") {
    return {
      kind: "network",
      message: "That took too long — check the companion is running and retry.",
      raw: stackOrMessage(err),
    };
  }
  const msg = e?.message ?? String(err);
  if (/network|fetch|reach|connect/i.test(msg)) {
    return {
      kind: "network",
      message: msg,
      raw: stackOrMessage(err),
    };
  }
  return {
    kind: "unknown",
    message: msg,
    raw: stackOrMessage(err),
  };
}

function stackOrMessage(err: unknown): string {
  const e = err as Error;
  return e?.stack ?? e?.message ?? String(err);
}
