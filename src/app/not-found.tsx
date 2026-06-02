"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { buttonClasses } from "@/components/ui";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Single 404 surface for the static export (GitHub Pages serves this exported
// 404.html for any unknown path). PER-167: we no longer redirect unknown
// `/app/*` to the app shell — that masked dead routes/typos by silently
// rendering the brief. The only real `/app/*` routes (`/app`, `/app/connect`)
// are statically prerendered with their own index.html and never reach this
// page, so any `/app/*` that lands here is genuinely unknown and should 404.
//
// We branch on pathname so an onboarded user who mistypes an `/app/*` URL gets
// an in-app 404 (app chrome + a route back into the brief) rather than the
// marketing-home recovery. Non-`/app` paths keep the generic public 404, since
// 404.html is shared with the public github.io site (PER-144).
//
// The static markup pre-rendered at build time is the generic variant; after
// hydration we read the real pathname and swap to the app-aware variant for
// `/app/*`. Both states are valid 404s (no brief flash), so the swap is
// acceptable progressive enhancement.
type Resolved = { isAppPath: boolean; attemptedPath: string };

export default function NotFound() {
  // Server-prerendered markup (the build-time 404.html) is the generic public
  // variant. After mount we read the real URL and, for `/app/*`, swap to the
  // app-aware variant. Reading `window.location` is an external-system read that
  // can only happen client-side, so the post-mount setState is intentional here
  // (matches the existing pattern in app/page.tsx).
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    const { pathname } = window.location;
    const withoutBase =
      BASE_PATH && pathname.startsWith(BASE_PATH)
        ? pathname.slice(BASE_PATH.length)
        : pathname;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({
      isAppPath: withoutBase === "/app" || withoutBase.startsWith("/app/"),
      attemptedPath: withoutBase || "/",
    });
  }, []);

  if (resolved?.isAppPath) {
    const attemptedPath = resolved.attemptedPath;
    return (
      <main className="flex min-h-screen flex-col bg-page font-sans text-primary">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <AppNav />
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-24">
          <div className="flex flex-col gap-4">
            <p className="text-caption font-medium uppercase text-muted">404</p>
            <h1 className="text-title-1 text-primary">Page not found</h1>
            <p className="text-secondary">
              We couldn&rsquo;t find that page. The link may be mistyped or no
              longer exist.
            </p>
            {attemptedPath ? (
              <p className="font-mono text-body-sm text-muted">{attemptedPath}</p>
            ) : null}
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Link href="/app/" className={`${buttonClasses("primary")} w-full sm:w-auto`}>
                Go to your brief
              </Link>
              <Link
                href="/"
                className={`${buttonClasses("secondary")} w-full sm:w-auto`}
              >
                Back to Scout home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-24 font-sans text-primary">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <p className="text-caption font-medium uppercase text-muted">404</p>
        <h1 className="text-title-1 text-primary">Page not found</h1>
        <p className="text-secondary">
          That page does not exist yet. Head back to{" "}
          <Link className="underline" href="/">
            the home page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
