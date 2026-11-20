"use client";

import { HostedSettings } from "@/components/hosted/HostedSettings";
import { ScheduleSettings } from "@/components/ScheduleSettings";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@/components/ui";
import { isHostedBuild } from "@/lib/auth";

export default function SettingsPage() {
  if (isHostedBuild()) return <HostedSettings />;
  return (
    <AppShell>
      <PageHeader title="Settings" back={{ href: "/app/", label: "Brief" }} />
      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme">
          <ThemeToggle showLabels />
        </SettingsRow>
      </SettingsGroup>
      <ScheduleSettings />
      <SettingsGroup
        title="Research"
        footer="How Scout finds and writes your stories."
      >
        <SettingsLinkRow href="/app/skills/">Skills</SettingsLinkRow>
      </SettingsGroup>
    </AppShell>
  );
}
