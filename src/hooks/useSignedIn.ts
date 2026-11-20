"use client";

import * as React from "react";
import { hostedAuth, isHostedBuild } from "@/lib/auth";

/**
 * Whether a reader is signed in: null while the hosted build is still
 * checking, always true on the companion (it has no accounts).
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const auth = hostedAuth();
    if (!auth) return;
    let live = true;
    void auth
      .currentUser()
      .catch(() => null)
      .then((user) => live && setSignedIn(user !== null));
    return () => {
      live = false;
    };
  }, []);
  return isHostedBuild() ? signedIn : true;
}

type Back = { href: string; label: string };

/**
 * A page's back link: `signedIn` for a reader, `signedOut` for a visitor
 * (who can't open the app's screens), "pending" while it is unknown.
 */
export function useBackLink(signedIn: Back, signedOut: Back): Back | "pending" {
  const state = useSignedIn();
  if (state === null) return "pending";
  return state ? signedIn : signedOut;
}
