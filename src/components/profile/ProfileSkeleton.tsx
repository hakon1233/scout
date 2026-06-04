"use client";

export function ProfileSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded-lg border border-border-default bg-surface p-4"
        >
          <div className="space-y-2">
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-muted" />
            <div className="h-2.5 w-28 animate-pulse rounded bg-surface-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
