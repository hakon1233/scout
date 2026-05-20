import * as React from "react";
import { Card } from "@/components/ui";

export function BriefSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <Card key={i} padding="md">
          <div className="flex flex-col gap-3">
            <SkeletonLine className="h-5 w-2/5" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-11/12" />
            <SkeletonLine className="h-3 w-3/4" />
          </div>
        </Card>
      ))}
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
