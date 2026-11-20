"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useHostedData } from "@/hooks/useHostedData";
import { ScoutWordmark } from "@/components/shell/AppShell";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefLayout } from "@/components/BriefLayout";
import { PushBell } from "@/components/PushBell";
import { ReportLink } from "@/components/ReportSheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, buttonClasses } from "@/components/ui";
import { useTopicPush } from "@/hooks/useTopicPush";
import { hostedAuth } from "@/lib/auth";
import { HostedError, type SharedInterest } from "@/lib/hosted";
import { startUsage } from "@/lib/usage";

// A share link's page: `/i/?s=<slug>`. Anyone can read the interest's latest
// brief, signed in or out; a signed-in reader can follow it. The site is a
// static export, so the slug is read from the URL here on the client.
export default function SharedPage() {
  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <nav className="flex items-center justify-between gap-3">
          <ScoutWordmark />
          <ThemeToggle />
        </nav>
        <React.Suspense fallback={<AppSkeleton />}>
          <Shared />
        </React.Suspense>
      </div>
    </main>
  );
}

type View =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; interest: SharedInterest };

function Shared() {
  const slug = useSearchParams().get("s") ?? "";
  const data = useHostedData();
  const router = useRouter();
  const [view, setView] = React.useState<View>({ kind: "loading" });
  const [signedIn, setSignedIn] = React.useState(false);
  const [following, setFollowing] = React.useState(false);
  const [followError, setFollowError] = React.useState<string | null>(null);
  // The topic's bell, for a signed-in reader who owns or follows it.
  const push = useTopicPush(signedIn ? data : null);
  const ready = view.kind === "ready" ? view.interest : null;

  // A signed-in reader's reading here counts toward their picks too.
  React.useEffect(() => {
    if (data && signedIn && ready)
      startUsage(data, [{ id: ready.id, topic: ready.topic }]);
  }, [data, signedIn, ready]);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.all([
      slug ? data.shared(slug) : Promise.resolve(null),
      hostedAuth()
        ?.currentUser()
        .catch(() => null) ?? null,
    ])
      .then(([interest, signed]) => {
        if (!live) return;
        setSignedIn(signed !== null);
        setView(interest ? { kind: "ready", interest } : { kind: "gone" });
      })
      .catch(() => {
        if (live)
          setView({
            kind: "failed",
            message: "Couldn't load this brief. Try again.",
          });
      });
    return () => {
      live = false;
    };
  }, [data, slug]);

  if (!data)
    return (
      <Message title="Sharing isn't available here">
        This copy of Scout runs on your own computer, so it can&rsquo;t open
        share links.
      </Message>
    );
  if (view.kind === "loading") return <AppSkeleton />;
  if (view.kind === "gone")
    return (
      <Message title="This link isn't shared anymore">
        Ask whoever sent it for a new link, or make a brief of your own.
      </Message>
    );
  if (view.kind === "failed")
    return (
      <div className="flex flex-col items-start gap-3" data-main>
        <p className="text-body text-danger">{view.message}</p>
        <Button variant="secondary" onClick={() => location.reload()}>
          Try again
        </Button>
      </div>
    );

  const i = view.interest;
  const yours = i.owned || i.following || following;

  async function follow() {
    setFollowError(null);
    try {
      await data!.follow(slug);
      setFollowing(true);
      router.push("/app/");
    } catch (err) {
      if (err instanceof HostedError && err.kind === "signed-out") {
        router.push("/app/signin/");
        return;
      }
      setFollowError(
        err instanceof HostedError
          ? err.message
          : "Couldn't follow it. Try again.",
      );
    }
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-56 text-body text-secondary text-pretty">
            {yours
              ? "Its new briefs show in your Scout."
              : "A Scout brief. Follow it to get each new one in your Scout, free."}
          </p>
          {yours ? (
            <span className="flex items-center gap-2">
              {signedIn && (
                <PushBell
                  topic={i.topic}
                  on={push.isOn(i.id)}
                  onChange={(on) => push.set(i.id, on)}
                  deviceOn={push.deviceOn}
                  blocked={push.blocked}
                />
              )}
              <Link href="/app/" className={buttonClasses("secondary", "sm")}>
                Open Scout
              </Link>
            </span>
          ) : signedIn ? (
            <FollowButton onFollow={follow} />
          ) : (
            <Link
              href="/app/signin/"
              className={buttonClasses("primary", "sm")}
            >
              Sign in to follow
            </Link>
          )}
        </div>
        {(followError ?? push.error) && (
          <p role="alert" className="text-body-sm text-danger">
            {followError ?? push.error}
          </p>
        )}
      </section>
      <div data-main>
        {i.brief ? (
          // BriefLayout's heading is the page's one h1: "<topic> — <date>".
          <BriefLayout brief={i.brief} name="" heading={i.topic} />
        ) : (
          <section className="flex flex-col gap-2">
            <h1 className="break-words font-serif text-title-1 text-balance">
              {i.topic}
            </h1>
            <p className="text-body text-secondary">
              No brief yet. The first one shows here after its next run.
            </p>
          </section>
        )}
      </div>
      {signedIn && !i.owned && (
        <footer className="border-t border-border-default pt-4">
          <ReportLink
            data={data}
            interestId={i.id}
            topic={i.topic}
            label="Report this topic"
          />
        </footer>
      )}
    </>
  );
}

function FollowButton({ onFollow }: { onFollow: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  async function follow() {
    setBusy(true);
    await onFollow();
    setBusy(false);
  }
  return (
    <Button size="sm" loading={busy} onClick={() => void follow()}>
      Follow
    </Button>
  );
}

function Message({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-3" data-main>
      <h1 className="font-serif text-title-1 text-balance">{title}</h1>
      <p className="text-body text-secondary text-pretty">{children}</p>
      <Link href="/" className={buttonClasses("secondary", "sm")}>
        About Scout
      </Link>
    </section>
  );
}
