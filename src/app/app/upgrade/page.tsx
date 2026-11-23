"use client";

import * as React from "react";
import { useHostedData } from "@/hooks/useHostedData";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui";
import {
  PLANS,
  planFor,
  planGains,
  priceAbroadText,
  priceText,
  type Plan,
} from "@/lib/plans";

// Free vs Plus. Payment is a placeholder: both ways say "Coming soon" and make
// no calls. Vipps first (most readers are in Norway), then card by Stripe.
// TODO(payments backend): wire both buttons once checkout exists.
export default function UpgradePage() {
  const data = useHostedData();
  // The reader's plan once the database says; no "Your plan" until then.
  const [current, setCurrent] = React.useState<Plan["id"] | null>(null);
  React.useEffect(() => {
    let live = true;
    data
      ?.home()
      .then((home) => {
        if (live) setCurrent(planFor(home.allowance.plan).id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [data]);

  return (
    <AppShell menu={current ? { plan: current } : undefined}>
      <PageHeader
        title="Upgrade"
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        Daily briefs and more weekly ones.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2" data-main>
        <PlanCard plan={PLANS.free} current={current === "free"} />
        <PlanCard plan={PLANS.plus} current={current === "plus"} />
      </div>
      <section aria-labelledby="pay" className="flex flex-col gap-3">
        <h2 id="pay" className="text-body-sm font-medium text-secondary">
          Pay for Plus
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" disabled className="sm:flex-1">
            Vipps · Coming soon
          </Button>
          <Button variant="secondary" disabled className="sm:flex-1">
            Card (Stripe) · Coming soon
          </Button>
        </div>
        <p className="text-caption text-muted">
          Payments aren&apos;t open yet. Cancel any time once they are.
        </p>
      </section>
    </AppShell>
  );
}

function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  return (
    <article
      aria-label={`${plan.name} plan`}
      className={`flex flex-col gap-3 rounded-card border bg-surface p-5 ${current ? "border-border-strong" : "border-border-default"}`}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-title-2 text-primary">{plan.name}</h3>
          {current && (
            <span className="text-caption text-secondary">Your plan</span>
          )}
        </div>
        <p className="text-body-sm text-primary">{priceText(plan)}</p>
        {priceAbroadText(plan) && (
          <p className="text-caption text-muted">{priceAbroadText(plan)}</p>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 text-body-sm text-secondary">
        {planGains(plan).map((line) => (
          <li
            key={line.text}
            className={`flex gap-2 ${line.included ? "" : "text-muted"}`}
          >
            <span
              aria-hidden="true"
              className={line.included ? "text-good" : "text-muted"}
            >
              {line.included ? "✓" : "–"}
            </span>
            {line.text}
          </li>
        ))}
      </ul>
    </article>
  );
}
