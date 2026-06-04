"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { bootstrapCompanionToken, pingCompanion } from "@/lib/companion";

export function PairedEntryRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await bootstrapCompanionToken();
      if (!token) return;
      const ready = await pingCompanion();
      if (!cancelled && ready) router.replace("/app/");
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
