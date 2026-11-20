"use client";

import * as React from "react";
import { showTabTitle } from "@/lib/tab-title";

/** The tab shows `name · Scout` while the page shows that thing. */
export function useTabTitle(name: string | null | undefined) {
  React.useEffect(() => showTabTitle(document, name), [name]);
}
