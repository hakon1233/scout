"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { HostedTopic } from "@/components/hosted/HostedTopic";
import { HostedTopics } from "@/components/hosted/HostedTopics";
import { AppShell } from "@/components/shell/AppShell";
import { AppSkeleton } from "@/components/AppSkeleton";
import { isHostedBuild } from "@/lib/auth";

export default function TopicsPage() {
  if (isHostedBuild())
    return (
      <Suspense
        fallback={
          <AppShell>
            <AppSkeleton />
          </AppShell>
        }
      >
        <HostedTopicsRoute />
      </Suspense>
    );
  return <CompanionTopics />;
}

// /app/topics/ lists the reader's topics; ?id=… opens one topic's own page.
function HostedTopicsRoute() {
  const id = useSearchParams().get("id");
  return id ? <HostedTopic key={id} id={id} /> : <HostedTopics />;
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
