// One grey line of a loading placeholder; the caller sets its height and width.
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      className={`scout-skeleton block rounded-sm bg-surface-muted ${className}`}
    />
  );
}
