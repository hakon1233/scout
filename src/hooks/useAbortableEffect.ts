"use client";

import { useCallback, useEffect, useRef } from "react";
import type { DependencyList, MutableRefObject } from "react";

export type AbortableEffectScope = {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
};

export function useAbortableEffect(
  effect: (scope: AbortableEffectScope) => void | (() => void),
  deps: DependencyList,
): void {
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const scope: AbortableEffectScope = {
      signal: controller.signal,
      get cancelled() {
        return cancelled;
      },
    };
    const cleanup = effect(scope);
    return () => {
      cancelled = true;
      controller.abort();
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useAbortableController(): {
  abortRef: MutableRefObject<AbortController | null>;
  startAbortable: () => AbortController;
  clearAbortable: (controller: AbortController) => void;
  abortCurrent: () => void;
} {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const startAbortable = useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const clearAbortable = useCallback((controller: AbortController) => {
    if (abortRef.current === controller) abortRef.current = null;
  }, []);

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { abortRef, startAbortable, clearAbortable, abortCurrent };
}
