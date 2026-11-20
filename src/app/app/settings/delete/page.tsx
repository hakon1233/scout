"use client";

import { DeleteAccount } from "@/components/hosted/HostedSettings";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { isHostedBuild } from "@/lib/auth";

export default function DeleteAccountPage() {
  if (isHostedBuild()) return <DeleteAccount />;
  return (
    <AppShell>
      <PageHeader
        title="Delete account"
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        This copy of Scout runs on your computer with no account. Your reading
        list lives in its state file there.
      </PageHeader>
    </AppShell>
  );
}
