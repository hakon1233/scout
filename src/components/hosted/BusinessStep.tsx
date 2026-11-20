"use client";

import * as React from "react";
import { Button, Card } from "@/components/ui";
import {
  KOMMUNE_LIST,
  TRADES,
  findKommune,
  findTrade,
  starterTopics,
} from "@/lib/business-starter";
import { HostedError, type HostedData, type Profile } from "@/lib/hosted";
import { getLocalStorage, safeSetItem } from "@/lib/safe-storage";
import { scheduleNew } from "./useHostedHome";

// The optional business step on the first-run screen: pick a trade and a
// kommune, then add that trade's ready-made topics one tap each. "Not now"
// hides it for good on this device. Fills the profile's "Where you live" and
// "What you do" only while they are empty; stores nothing else.

const SKIPPED = "scout.business.skipped";

export function businessStepSkipped(): boolean {
  try {
    return getLocalStorage()?.getItem(SKIPPED) === "1";
  } catch {
    return false;
  }
}

const FIELD =
  "min-h-11 w-full rounded-[12px] border border-border-strong bg-surface px-3 text-base text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:text-body-sm";

export function BusinessStep({
  data,
  onAdded,
  onClose,
}: {
  data: HostedData;
  // After each topic is created and scheduled.
  onAdded: () => Promise<void> | void;
  // "Not now" or "Done".
  onClose: () => void;
}) {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [tradeId, setTradeId] = React.useState("");
  const [place, setPlace] = React.useState("");
  const [placeError, setPlaceError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<ReadonlySet<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const placeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let live = true;
    data
      .profile()
      .then((p) => {
        if (!live) return;
        setProfile(p);
        const k = findKommune(p.location);
        if (k) setPlace((typed) => typed || k.name);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [data]);

  const trade = findTrade(tradeId);
  const kommune = findKommune(place);
  const topics = trade
    ? starterTopics(trade, kommune ?? { number: "", name: "your kommune" })
    : [];

  async function add(templateId: string) {
    if (!trade) return;
    if (!kommune) {
      setPlaceError("Pick a kommune from the list.");
      placeRef.current?.focus();
      return;
    }
    const t = starterTopics(trade, kommune).find((x) => x.id === templateId);
    if (!t) return;
    setBusy(templateId);
    setError(null);
    try {
      const id = await data.createTopic(t.topic, t.doc);
      await scheduleNew(data, [id]);
      setAdded((s) => new Set(s).add(`${trade.id}/${templateId}`));
      const change: Partial<Profile> = {};
      if (!profile?.location) change.location = kommune.name;
      if (!profile?.role) change.role = trade.role;
      if (Object.keys(change).length > 0) {
        setProfile((p) => (p ? { ...p, ...change } : p));
        // The topic is what counts; a profile that didn't save stays empty.
        await data.setProfile(change).catch(() => {});
      }
      await onAdded();
    } catch (err) {
      setError(
        err instanceof HostedError
          ? err.message
          : "Couldn't add that topic. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    safeSetItem(SKIPPED, "1");
    onClose();
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-body font-medium text-primary">Run a business?</h2>
        <p className="text-body-sm text-secondary text-pretty">
          Pick your trade and kommune for ready-made topics.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="business-trade" className="text-body-sm text-primary">
            What do you do?
          </label>
          <select
            id="business-trade"
            value={tradeId}
            onChange={(e) => setTradeId(e.target.value)}
            className={FIELD}
          >
            <option value="">Choose your trade</option>
            {TRADES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor="business-kommune"
            className="text-body-sm text-primary"
          >
            Kommune
          </label>
          <input
            id="business-kommune"
            ref={placeRef}
            value={place}
            list="business-kommuner"
            placeholder="Start typing, e.g. Bergen"
            autoComplete="address-level2"
            maxLength={60}
            aria-invalid={placeError ? true : undefined}
            aria-describedby={placeError ? "business-kommune-error" : undefined}
            onChange={(e) => {
              setPlace(e.target.value);
              setPlaceError(null);
            }}
            onBlur={() => {
              if (place.trim() && !findKommune(place))
                setPlaceError("Pick a kommune from the list.");
            }}
            className={FIELD}
          />
          <datalist id="business-kommuner">
            {KOMMUNE_LIST.map((k) => (
              <option key={k.number} value={k.name} />
            ))}
          </datalist>
          {placeError && (
            <p
              id="business-kommune-error"
              role="alert"
              className="text-body-sm text-danger"
            >
              {placeError}
            </p>
          )}
        </div>
      </div>

      {trade && (
        <ul className="flex flex-col divide-y divide-border-default border-y border-border-default">
          {topics.map((t) => {
            const done = added.has(`${trade.id}/${t.id}`);
            return (
              <li
                key={t.id}
                className="flex min-h-12 items-center justify-between gap-3"
              >
                <span className="min-w-0 text-body-sm text-primary text-pretty">
                  {t.topic}
                </span>
                {done ? (
                  <span className="shrink-0 px-3 text-body-sm text-secondary">
                    Added
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 max-sm:min-h-11"
                    loading={busy === t.id}
                    disabled={busy !== null && busy !== t.id}
                    onClick={() => void add(t.id)}
                    aria-label={`Add ${t.topic}`}
                  >
                    Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 max-sm:min-h-11"
          onClick={close}
        >
          {added.size > 0 ? "Done" : "Not now"}
        </Button>
      </div>
    </Card>
  );
}
