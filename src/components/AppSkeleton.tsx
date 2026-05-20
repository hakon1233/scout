import * as React from "react";
import { Card } from "@/components/ui";

export function AppSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border-default pb-4">
        <SkeletonLine className="h-3 w-24" />
        <SkeletonLine className="h-7 w-2/3 sm:w-1/2" />
        <div className="flex flex-wrap gap-2 pt-1">
          <SkeletonChip className="w-20" />
          <SkeletonChip className="w-28" />
          <SkeletonChip className="w-16" />
        </div>
      </div>
      {[0, 1].map((i) => (
        <Card key={i} padding="md">
          <div className="flex flex-col gap-3">
            <SkeletonLine className="h-5 w-2/5" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-11/12" />
            <SkeletonLine className="h-3 w-3/4" />
          </div>
        </Card>
      ))}
      <span className="sr-only">Loading your brief…</span>
    </div>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      className={`notiva-skeleton block rounded-sm bg-surface-muted ${className}`}
    />
  );
}

function SkeletonChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`notiva-skeleton inline-block h-6 rounded-pill bg-surface-muted ${className}`}
    />
  );
}
