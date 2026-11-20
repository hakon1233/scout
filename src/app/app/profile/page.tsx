"use client";

import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SettingsGroup, SettingsLinkRow } from "@/components/ui";

// Placeholder until profiles land (display name, likes across devices); a
// later job fills it. Liked stories already work and live here.
export default function ProfilePage() {
  return (
    <AppShell>
      <PageHeader title="Profile" back={{ href: "/app/", label: "Brief" }}>
        Your name, likes and reading history come here soon.
      </PageHeader>
      <SettingsGroup title="Saved">
        <SettingsLinkRow href="/app/liked/">Liked stories</SettingsLinkRow>
      </SettingsGroup>
    </AppShell>
  );
}
