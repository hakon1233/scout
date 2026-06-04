"use client";

import { ScheduleSettings } from "@/components/ScheduleSettings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProfilePageShell } from "@/components/profile/ProfilePageShell";

export default function SettingsPage() {
  return (
    <ProfilePageShell
      eyebrow="Settings"
      title="Settings"
      description="Control how Scout looks and when its local companion delivers briefs."
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        <section className="space-y-4 border-t border-border-default pt-5">
          <div>
            <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
              Theme
            </h2>
            <p className="mt-2 font-reading text-[15px] leading-relaxed text-secondary">
              Pick a fixed theme or let Scout follow your operating system.
            </p>
          </div>
          <ThemeToggle showLabels />
        </section>

        <section className="border-t border-border-default pt-5">
          <ScheduleSettings />
        </section>
      </div>
    </ProfilePageShell>
  );
}
