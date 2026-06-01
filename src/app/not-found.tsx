"use client";

import { useEffect } from "react";
import Link from "next/link";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function NotFound() {
  useEffect(() => {
    // SPA fallback for static hosting. GitHub Pages serves this exported
    // 404.html for any unknown path. In-app views like settings are panels
    // rendered at /app/, not real export routes, so a deep-link or refresh of
    // /app/* should land on the app shell rather than dead-end here (PER-127).
    const appRoot = `${BASE_PATH}/app/`;
    const { pathname } = window.location;
    if (pathname.startsWith(`${BASE_PATH}/app`) && pathname !== appRoot) {
      window.location.replace(appRoot);
    }
  }, []);

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
