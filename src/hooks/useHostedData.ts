"use client";

import * as React from "react";
import { hostedData, type HostedData } from "@/lib/hosted";

const noSubscribe = () => () => {};

/**
 * The hosted data client for a component. Null on the server and during
 * hydration (the static HTML was built without it), then the client: calling
 * hostedData() straight in render makes the first client render differ from
 * the HTML, which React reports as a hydration error.
 */
export function useHostedData(): HostedData | null {
  return React.useSyncExternalStore(noSubscribe, hostedData, () => null);
}
