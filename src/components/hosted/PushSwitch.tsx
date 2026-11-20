"use client";

import * as React from "react";
import { Toggle } from "@/components/ui/Toggle";
import type { HostedData, PushState } from "@/lib/hosted";

// "Notify me when a brief is ready" for this device. Hidden where the browser
// has no push; on an iPhone outside the Home Screen it says how to get it.
export function PushSwitch({ data }: { data: HostedData }) {
  const [state, setState] = React.useState<PushState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    data.pushStatus().then(setState, () => setState("unsupported"));
  }, [data]);

  if (state === null || state === "unsupported") return null;
  if (state === "needs-install")
    return (
      <p className="text-body-sm text-muted">
        Add Scout to your Home Screen to get notifications.
      </p>
    );

  function change(on: boolean) {
    setBusy(true);
    setError(null);
    // Called straight from the tap: the browser asks permission only then.
    (on ? data.pushEnable() : data.pushDisable())
      .then(setState, () =>
        setError("Couldn't change notifications. Try again."),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3 text-body-sm">
        <span>Notify me when a brief is ready</span>
        <Toggle
          checked={state === "on"}
          onChange={change}
          label="Notify me when a brief is ready"
          busy={busy}
          disabled={state === "denied"}
        />
      </label>
      {state === "denied" && (
        <p className="text-body-sm text-muted">
          Notifications are blocked for Scout. Allow them in your browser or
          phone settings, then reload.
        </p>
      )}
      {error && (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
