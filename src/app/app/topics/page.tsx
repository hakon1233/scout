"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { HostedTopics } from "@/components/hosted/HostedTopics";
import { AppShell } from "@/components/shell/AppShell";
import { AppSkeleton } from "@/components/AppSkeleton";
import { isHostedBuild } from "@/lib/auth";

export default function TopicsPage() {
  if (isHostedBuild()) return <HostedTopics />;
  return <CompanionTopics />;
}

// The companion's topics live in its workbench (docs, skills and chat).
function CompanionTopics() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/app/interests/${window.location.search}`);
  }, [router]);
  return (
    <AppShell>
      <AppSkeleton />
    </AppShell>
  );
}
