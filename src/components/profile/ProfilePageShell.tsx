"use client";

import { AppNav } from "@/components/AppNav";
import type React from "react";

export function ProfilePageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-page text-primary">
      <div className="mx-auto max-w-6xl space-y-8 px-5 py-10">
        <AppNav />
        <header className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-signal">
            <span className="h-[1.5px] w-[26px] bg-signal" />
            {eyebrow}
          </p>
          <h1 className="mb-2 font-serif text-[34px] font-semibold leading-[1.1] tracking-[0]">
            {title}
          </h1>
          <p className="font-reading text-[17px] leading-relaxed text-secondary">
            {description}
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}
