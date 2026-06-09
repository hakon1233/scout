"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The standalone chat page was consolidated into /app/interests (PER-228
// follow-up): the interest page now hosts the full-height chat in its right
// pane. Keep this route as a redirect so old nav entries and deep links
// (including ?focus=…) keep working.
export default function ChatRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/app/interests${window.location.search}`);
  }, [router]);

  return (
    <main className="min-h-screen bg-page px-5 py-10 text-primary">
      <div className="mx-auto max-w-3xl">
        <p className="font-reading text-[15px] leading-relaxed text-secondary">
          Chat moved — it now lives on the{" "}
          <Link href="/app/interests" className="text-signal underline">
            interests page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
