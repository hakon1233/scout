// "Local": a local account's topics run on Håkon's Mac (profiles.runs_local).
// The same pill as BriefLayout's "Written by AI".
export function LocalBadge() {
  return (
    <span
      title="Runs on your Mac"
      className="inline-flex rounded-pill border border-border-default px-2 py-0.5 align-middle text-caption text-secondary"
    >
      Local
    </span>
  );
}

// A queued run's status: a local account waits for the Mac, not the Worker.
export const WAITING_FOR_MAC = "Waiting for your Mac";
