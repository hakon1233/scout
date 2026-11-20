"use client";

import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui";
import {
  PLANS,
  planLines,
  priceAbroadText,
  priceText,
  type Plan,
} from "@/lib/plans";

// Free vs Plus. Payment is a placeholder: both ways say "Coming soon" and make
// no calls. Vipps first (most readers are in Norway), then card by Stripe.
// TODO(payments backend): wire both buttons once checkout exists.
export default function UpgradePage() {
  return (
    <AppShell>
      <PageHeader
        title="Upgrade"
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        More topics and more daily briefs.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2" data-main>
        <PlanCard plan={PLANS.free} />
        <PlanCard plan={PLANS.plus} featured />
      </div>
      <section aria-labelledby="pay" className="flex flex-col gap-3">
        <h2 id="pay" className="text-body-sm font-medium text-secondary">
          Pay for Plus
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button disabled className="sm:flex-1">
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

function PlanCard({
  plan,
  featured = false,
}: {
  plan: Plan;
  featured?: boolean;
}) {
  return (
    <article
      aria-label={`${plan.name} plan`}
      className={`flex flex-col gap-3 rounded-card border bg-surface p-5 ${featured ? "border-border-strong" : "border-border-default"}`}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-serif text-title-2 text-primary">{plan.name}</h3>
        <p className="text-body-sm text-primary">{priceText(plan)}</p>
        {priceAbroadText(plan) && (
          <p className="text-caption text-muted">{priceAbroadText(plan)}</p>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 text-body-sm text-secondary">
        {planLines(plan).map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden="true" className="text-good">
              ✓
            </span>
            {line}
          </li>
        ))}
      </ul>
    </article>
  );
}
