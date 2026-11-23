"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { EmailToggle } from "@/components/EmailToggle";
import { PushBell } from "@/components/PushBell";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Button,
  SettingsGroup,
  SettingsLinkRow,
  SettingsRow,
} from "@/components/ui";
import { useTopicEmail } from "@/hooks/useTopicEmail";
import { useTopicPush } from "@/hooks/useTopicPush";
import { hostedAuth } from "@/lib/auth";
import {
  HostedError,
  type HostedData,
  type HostedHome,
  type HostedInterest,
} from "@/lib/hosted";
import { planFor, planMeters } from "@/lib/plans";
import {
  defaultTimeZone,
  detectedTimeZone,
  timeZoneOptions,
} from "@/lib/time-zone";
import { hostedMenu } from "./HostedHome";
import { PushSwitch } from "./PushSwitch";
import { resumeSlot, useHostedHome } from "./useHostedHome";

// Hosted Settings: one page of groups. Appearance, notifications (this device
// and each topic), time zone, plan, account.
export function HostedSettings() {
  const { data, home, loadError, reload } = useHostedHome();
  const push = useTopicPush(data);
  const email = useTopicEmail(data);

  return (
    <AppShell menu={home ? hostedMenu(home) : undefined}>
      <PageHeader title="Settings" back={{ href: "/app/", label: "Brief" }} />
      {loadError && (
        <p role="alert" className="text-body-sm text-danger">
          {loadError}
        </p>
      )}

      <div className="flex flex-col gap-6" data-main>
        <SettingsGroup title="Appearance">
          <SettingsRow label="Theme">
            <ThemeToggle showLabels />
          </SettingsRow>
        </SettingsGroup>

        {data && (
          <SettingsGroup
            title="Notifications"
            footer={
              push.error ??
              email.error ??
              (email.enabled
                ? "Each topic is off until you turn on its bell or its envelope (new briefs by email). Turning a bell on also turns on this device."
                : "Each topic is off until you turn on its bell. Turning one on also turns on this device.")
            }
          >
            <div className="px-4 py-3">
              <PushSwitch
                data={data}
                device={push.device}
                onChange={push.deviceChanged}
              />
            </div>
            {home?.interests.map((t) => (
              <SettingsRow key={t.id} label={t.topic}>
                <span className="inline-flex">
                  {email.enabled && (
                    <EmailToggle
                      topic={t.topic}
                      on={email.isOn(t.id)}
                      onChange={(on) => email.set(t.id, on)}
                    />
                  )}
                  <PushBell
                    topic={t.topic}
                    on={push.isOn(t.id)}
                    onChange={(on) => push.set(t.id, on)}
                    deviceOn={push.deviceOn}
                    blocked={push.blocked}
                  />
                </span>
              </SettingsRow>
            ))}
          </SettingsGroup>
        )}

        {data && <TimeZoneGroup data={data} />}
        {data && home && (
          <TopicsGroup data={data} home={home} reload={reload} />
        )}
        {home && <PlanGroup home={home} />}
        {data && <AccountGroup data={data} />}
      </div>
    </AppShell>
  );
}

function TimeZoneGroup({ data }: { data: HostedData }) {
  const [zone, setZone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void data
      .timeZone()
      .catch(() => null)
      .then(
        (saved) => live && setZone(defaultTimeZone(saved, detectedTimeZone())),
      );
    return () => {
      live = false;
    };
  }, [data]);

  function change(next: string) {
    const before = zone;
    setZone(next);
    setError(null);
    data.setTimeZone(next).catch((e: unknown) => {
      setZone(before);
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    });
  }

  return (
    <SettingsGroup
      title="Time zone"
      footer={
        error ??
        "Your briefs run at their set time in this time zone. Brief length and how many stories are set on each topic's page."
      }
    >
      <SettingsRow label="Time zone">
        {zone && (
          <select
            aria-label="Time zone"
            value={zone}
            onChange={(e) => change(e.target.value)}
            className="h-11 max-w-[14rem] min-w-0 rounded-md border border-border-default bg-surface px-3 text-body-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {timeZoneOptions(zone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}

const CADENCE_LABEL = { daily: "Daily", weekly: "Weekly", off: "Paused" };

// Pause and Resume for the reader's own topics. Pausing frees its slot at
// once; Resume takes one back (resumeSlot) or says why it can't.
function TopicsGroup({
  data,
  home,
  reload,
}: {
  data: HostedData;
  home: HostedHome;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const own = home.interests.filter((i) => !i.following);
  if (own.length === 0) return null;

  async function toggle(i: HostedInterest) {
    setNotes(({ [i.id]: _, ...rest }) => rest);
    let cadence: "daily" | "weekly" | "off" = "off";
    if (i.cadence === "off") {
      const slot = resumeSlot(home.allowance, i.lastCadence);
      if ("message" in slot) {
        setNotes((n) => ({ ...n, [i.id]: slot.message }));
        return;
      }
      cadence = slot.cadence;
    }
    setBusy(i.id);
    try {
      await data.setCadence(i.id, cadence);
      await reload();
    } catch (err) {
      setNotes((n) => ({
        ...n,
        [i.id]:
          err instanceof HostedError
            ? err.message
            : "Couldn't save. Try again.",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup
      title="Topics"
      footer="A paused topic gets no briefs and frees its slot. Resume gives it back its daily or weekly slot when one is free."
    >
      {own.map((i) => (
        <SettingsRow
          key={i.id}
          label={i.topic}
          hint={
            notes[i.id] ? (
              <span role="alert" className="text-danger">
                {notes[i.id]}
              </span>
            ) : (
              CADENCE_LABEL[i.cadence]
            )
          }
        >
          <Button
            variant="secondary"
            size="sm"
            className="min-w-24"
            aria-label={`${i.cadence === "off" ? "Resume" : "Pause"} ${i.topic}`}
            loading={busy === i.id}
            disabled={busy !== null}
            onClick={() => void toggle(i)}
          >
            {i.cadence === "off" ? "Resume" : "Pause"}
          </Button>
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

function PlanGroup({ home }: { home: HostedHome }) {
  const plan = planFor(home.allowance.plan);
  const own = home.interests.filter((i) => !i.following);
  const meters = planMeters({
    ...home.allowance,
    publicTopics: own.filter((i) => i.visibility === "public").length,
  });
  return (
    <SettingsGroup
      title={`${plan.name} plan`}
      footer="Topics you follow don't count."
    >
      {meters.map((m) => (
        <SettingsRow key={m.label} label={m.label}>
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-20 overflow-hidden rounded-pill bg-surface-strong"
            >
              <span
                className="block h-full rounded-pill bg-secondary"
                style={{
                  width: `${m.limit > 0 ? Math.min(100, (m.used / m.limit) * 100) : 0}%`,
                }}
              />
            </span>
            <span className="text-body-sm tabular-nums text-secondary">
              {m.used} of {m.limit}
            </span>
          </span>
        </SettingsRow>
      ))}
      {plan.id === "free" && (
        <SettingsLinkRow href="/app/upgrade/">Upgrade to Plus</SettingsLinkRow>
      )}
    </SettingsGroup>
  );
}

function AccountGroup({ data }: { data: HostedData }) {
  const router = useRouter();
  const [email, setEmail] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    hostedAuth()
      ?.currentUser()
      .then((u) => setEmail(u?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      // This device stops getting pushes for an account it has left.
      await data.pushDisable().catch(() => undefined);
      await hostedAuth()?.signOut();
      router.replace("/app/signin/");
    } catch {
      setError("Couldn't sign out. Try again.");
      setBusy(false);
    }
  }

  return (
    <SettingsGroup title="Account" footer={error ?? undefined}>
      <SettingsRow label={email ?? "Signed in"}>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </SettingsRow>
      <SettingsLinkRow href="/app/privacy/">Privacy</SettingsLinkRow>
      <SettingsLinkRow href="/app/terms/">Terms</SettingsLinkRow>
      <SettingsLinkRow href="/app/settings/delete/" tone="danger">
        Delete account
      </SettingsLinkRow>
    </SettingsGroup>
  );
}

/** The delete confirm screen: type DELETE, then the account goes. */
export function DeleteAccount() {
  const { data, home } = useHostedHome();
  const router = useRouter();
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    if (typed.trim().toUpperCase() !== "DELETE") {
      setError("Type DELETE to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await data.deleteAccount();
      await hostedAuth()
        ?.signOut()
        .catch(() => undefined);
      router.replace("/app/signin/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <AppShell menu={home ? hostedMenu(home) : undefined}>
      <PageHeader
        title="Delete account"
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        This deletes your topics, briefs, likes and saves, and stops every topic
        others follow from you. It can&apos;t be undone.
      </PageHeader>
      <form
        onSubmit={(e) => void remove(e)}
        className="flex max-w-md flex-col gap-4"
        data-main
      >
        <label className="flex flex-col gap-2 text-body-sm">
          <span>Type DELETE to confirm</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            className="h-11 rounded-md border border-border-default bg-surface px-3 text-body text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </label>
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="danger" loading={busy}>
            Delete account
          </Button>
          <Link
            href="/app/settings/"
            className="inline-flex h-11 items-center px-2 text-body-sm text-secondary hover:text-primary"
          >
            Cancel
          </Link>
        </div>
      </form>
    </AppShell>
  );
}
