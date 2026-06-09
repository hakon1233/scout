"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppNav } from "@/components/AppNav";

export default function ProfileRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/settings");
  }, [router]);

  return (
    <main className="min-h-screen bg-page px-5 py-10 text-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <AppNav />
        <section className="rounded-lg border border-border-default bg-surface p-5">
          <p className="mb-2 font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
            Profile moved
          </p>
          <h1 className="mb-3 font-serif text-[28px] leading-tight">
            Choose a profile page
          </h1>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              href="/app/settings"
            >
              Settings
            </Link>
            <Link
              className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              href="/app/interests"
            >
              Interests &amp; chat
            </Link>
            <Link
              className="rounded-pill border border-border-default px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              href="/app/skills"
            >
              Skills
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
