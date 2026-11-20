"use client";

import { HostedProfile } from "@/components/hosted/HostedProfile";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SettingsGroup, SettingsLinkRow } from "@/components/ui";
import { hostedData } from "@/lib/hosted";

// Profile: the reader's private details for picks (hosted only), and their
// liked and saved stories, which work in both builds.
export default function ProfilePage() {
  const data = hostedData();
  return (
    <AppShell>
      <PageHeader title="Profile" back={{ href: "/app/", label: "Brief" }} />
      {data ? (
        <HostedProfile data={data} />
      ) : (
        <p className="-mt-2 text-body-sm text-secondary text-pretty" data-main>
          This copy of Scout runs on your own computer, so it keeps no profile.
          Your liked and saved stories stay on this device.
        </p>
      )}
      <SettingsGroup title="Stories">
        <SettingsLinkRow href="/app/liked/">Liked stories</SettingsLinkRow>
        <SettingsLinkRow href="/app/liked/?tab=saved">
          Saved for later
        </SettingsLinkRow>
      </SettingsGroup>
    </AppShell>
  );
}
