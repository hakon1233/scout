"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { BriefSettings } from "@scout/core";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefSettingsGroup } from "@/components/BriefSettingsGroup";
import { FeedView } from "@/components/FeedView";
import { EmailToggle } from "@/components/EmailToggle";
import { PushBell } from "@/components/PushBell";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Button, Segmented, SettingsGroup, SettingsRow } from "@/components/ui";
import { useTopicEmail } from "@/hooks/useTopicEmail";
import { useTopicPush } from "@/hooks/useTopicPush";
import { formatDate } from "@/lib/format-date";
import { dailyOffered, planFor } from "@/lib/plans";
import {
  HostedError,
  type Cadence,
  type HostedData,
  type HostedHome as Home,
  type HostedInterest,
} from "@/lib/hosted";
import { hostedMenu } from "./HostedHome";
import { PRIVACY } from "./HostedTopics";
import { SharingSection } from "./SharingSection";
import { LocalBadge, WAITING_FOR_MAC } from "./LocalBadge";
import { useHostedHome } from "./useHostedHome";
import { useTabTitle } from "@/hooks/useTabTitle";

const RUNS: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Paused" },
];

const RUNS_HINT: Record<Cadence, string> = {
  daily: "Every day",
  weekly: "Mondays",
  off: "Only when you run it",
};

// One topic's own page (/app/topics/?id=…): its latest stories first, then
// how its brief is written. The bell turns on push for just this topic.
export function HostedTopic({ id }: { id: string }) {
  const { data, home, loadError, reload, signedOut } = useHostedHome();
  const push = useTopicPush(data);
  const interest = home?.interests.find((i) => i.id === id) ?? null;
  useTabTitle(interest?.topic);

  return (
    <AppShell menu={home ? hostedMenu(home) : undefined}>
      {!data || !home ? (
        loadError ? (
          <p className="text-body text-danger">{loadError}</p>
        ) : (
          <AppSkeleton />
        )
      ) : !interest ? (
        <>
          <PageHeader
            title="Topic not found"
            back={{ href: "/app/topics/", label: "Topics" }}
          />
          <p className="text-body text-secondary" data-main>
            It may have been deleted or unshared. Open a topic from Topics.
          </p>
        </>
      ) : (
        <TopicPage
          data={data}
          home={home}
          interest={interest}
          reload={reload}
          signedOut={signedOut}
          push={push}
        />
      )}
    </AppShell>
  );
}

function TopicPage({
  data,
  home,
  interest: i,
  reload,
  signedOut,
  push,
}: {
  data: HostedData;
  home: Home;
  interest: HostedInterest;
  reload: () => Promise<void>;
  signedOut: (err: unknown) => boolean;
  push: ReturnType<typeof useTopicPush>;
}) {
  const router = useRouter();
  const email = useTopicEmail(data);
  const [runsError, setRunsError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [cadence, setCadence] = React.useState<Cadence>(i.cadence);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload wins
    setCadence(i.cadence);
  }, [i.cadence]);

  // The latest brief, cut down to this topic's stories.
  const brief = React.useMemo(() => {
    if (!home.brief) return null;
    const key = i.topic.trim().toLowerCase();
    const articles = home.brief.articles.filter(
      (a) => a.interest.trim().toLowerCase() === key,
    );
    return articles.length > 0 ? { ...home.brief, articles } : null;
  }, [home.brief, i.topic]);

  const save = React.useCallback(
    async (change: Partial<BriefSettings>) => {
      try {
        await data.setBriefSettings(i.id, change);
      } catch (err) {
        signedOut(err);
        throw err;
      }
      void reload();
      return { ...i.settings, ...change };
    },
    [data, i.id, i.settings, reload, signedOut],
  );

  async function changeRuns(next: Cadence) {
    const before = cadence;
    setCadence(next);
    setRunsError(null);
    try {
      await data.setCadence(i.id, next);
      await reload();
    } catch (err) {
      setCadence(before);
      if (!signedOut(err))
        setRunsError(
          err instanceof HostedError
            ? err.message
            : "Couldn't change the schedule. Try again.",
        );
    }
  }

  async function runNow() {
    setRunning(true);
    setRunError(null);
    try {
      await data.runNow(i.id);
      await reload();
    } catch (err) {
      if (!signedOut(err))
        setRunError(
          err instanceof HostedError
            ? err.message
            : "Couldn't start a run. Try again.",
        );
    } finally {
      setRunning(false);
    }
  }

  // A local account's own topic runs on the Mac (team runner).
  const local = home.runsLocal && !i.following;
  const status =
    i.run === "queued"
      ? local
        ? WAITING_FOR_MAC
        : "Waiting to start…"
      : i.run === "running"
        ? "Writing the brief…"
        : i.failed
          ? i.failed
          : i.updatedAt
            ? `Updated ${formatDate(i.updatedAt)}`
            : "No brief yet";
  const owner = i.following
    ? i.team
      ? "Scout team"
      : i.ownerName
        ? `By ${i.ownerName}`
        : "Followed"
    : PRIVACY[i.visibility];

  return (
    <>
      <PageHeader
        title={i.topic}
        back={{ href: "/app/topics/", label: "Topics" }}
        action={
          // -mr-3 puts the bell's glyph, not its 44 px hit area, on the
          // cards' right edge.
          <span className="-mr-3 inline-flex">
            {email.enabled && (
              <EmailToggle
                topic={i.topic}
                on={email.isOn(i.id)}
                onChange={(on) => email.set(i.id, on)}
              />
            )}
            <PushBell
              topic={i.topic}
              on={push.isOn(i.id)}
              onChange={(on) => push.set(i.id, on)}
              deviceOn={push.deviceOn}
              blocked={push.blocked}
            />
          </span>
        }
      >
        {owner} · {status}
        {i.make && " · Scout writes this"}
        {local && (
          <>
            {" "}
            <LocalBadge />
          </>
        )}
      </PageHeader>
      {(push.error ?? email.error) && (
        <p role="alert" className="text-body-sm text-danger">
          {push.error ?? email.error}
        </p>
      )}

      <section
        className="flex flex-col gap-3"
        aria-labelledby="topic-latest"
        data-main
      >
        <div className="flex items-center justify-between gap-3 pl-1">
          <h2 id="topic-latest" className="text-body-sm text-muted">
            Latest
          </h2>
          {!i.following && (
            <Button
              variant="secondary"
              size="sm"
              className="min-w-28"
              loading={i.run !== null || running}
              disabled={running}
              onClick={() => void runNow()}
            >
              {i.run ? "Running" : "Run now"}
            </Button>
          )}
        </div>
        {runError && (
          <p role="alert" className="px-1 text-body-sm text-danger">
            {runError}
          </p>
        )}
        {brief ? (
          <FeedView brief={brief} backLabel="Back to topic" />
        ) : (
          <p className="px-1 text-body text-secondary">
            No stories yet. The next brief fills this in.
          </p>
        )}
      </section>

      {i.following ? (
        <p className="px-1 text-body-sm text-muted">
          Only its owner sets its schedule and how its brief is written.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <BriefSettingsGroup
            settings={i.settings}
            save={save}
            stories={!i.make}
            extraRows={
              <SettingsRow label="Runs" hint={RUNS_HINT[cadence]}>
                <Segmented
                  label="Schedule"
                  value={cadence}
                  options={
                    dailyOffered(planFor(home.allowance.plan))
                      ? RUNS
                      : RUNS.map((r) =>
                          r.value === "daily"
                            ? { ...r, label: "Daily · Plus", disabled: true }
                            : r,
                        )
                  }
                  onChange={(c) => void changeRuns(c)}
                />
              </SettingsRow>
            }
          />
          {runsError && (
            <p role="alert" className="px-1 text-body-sm text-danger">
              {runsError}
            </p>
          )}
        </div>
      )}

      {!i.following && (
        <SettingsGroup title="Sharing">
          <div className="p-4">
            <SharingSection
              data={data}
              interest={i}
              publicUsed={
                home.interests.filter(
                  (x) => !x.following && x.visibility === "public",
                ).length
              }
              publicLimit={planFor(home.allowance.plan).publicTopics}
              onChanged={reload}
              onSignedOut={signedOut}
              onEdit={() => router.push("/app/topics/?new=1")}
            />
          </div>
        </SettingsGroup>
      )}
    </>
  );
}
