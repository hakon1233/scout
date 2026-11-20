// The plans Scout offers, in one place. The Upgrade page, the Settings plan
// meters and the menu's plan line all read from here. The database's plans
// table (what allowance() and the triggers enforce) holds the same numbers;
// test/plans-parity.test.mjs fails when the two disagree, so a change here
// needs a migration that sets the table to match.
//
// Prices are placeholders until payments go live (Vipps first, card by Stripe
// second).

export type PlanId = "free" | "plus";

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in Norwegian kroner (plans.price_nok). */
  priceNok: number;
  /** Monthly price outside Norway, in US cents (plans.price_usd_cents). */
  priceUsdCents: number;
  /** Own topics, any schedule (plans.max_interests). */
  topics: number;
  /** Topics that may run daily (plans.daily_interests). */
  dailyTopics: number;
  /** Topics that may run weekly (plans.weekly_interests). */
  weeklyTopics: number;
  /** "Run now" presses a day (plans.on_demand_runs_per_day). */
  runNowPerDay: number;
  /** Public topics (plans.max_public_interests). */
  publicTopics: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceNok: 0,
    priceUsdCents: 0,
    topics: 15,
    dailyTopics: 0,
    weeklyTopics: 3,
    runNowPerDay: 3,
    publicTopics: 3,
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceNok: 49,
    priceUsdCents: 500,
    topics: 30,
    dailyTopics: 1,
    weeklyTopics: 6,
    runNowPerDay: 3,
    publicTopics: 3,
  },
};

/** The plan for a name the database reports, Free when it is unknown. */
export function planFor(name: string | null | undefined): Plan {
  return name === "plus" ? PLANS.plus : PLANS.free;
}

/** The monthly price as shown, Norwegian kroner. */
export function priceText(p: Plan): string {
  return p.priceNok === 0 ? "0 kr" : `${p.priceNok} kr a month`;
}

/** The price for readers outside Norway, or null when free. */
export function priceAbroadText(p: Plan): string | null {
  if (p.priceUsdCents === 0) return null;
  const usd = p.priceUsdCents / 100;
  return `About $${Number.isInteger(usd) ? usd : usd.toFixed(2)} a month`;
}

/** Whether a plan has daily topics; Free has none, so Daily shows as Plus. */
export function dailyOffered(p: Plan): boolean {
  return p.dailyTopics > 0;
}

/** One line on a plan card; `included: false` marks what the plan lacks. */
export type PlanLine = { text: string; included: boolean };

const line = (text: string, included = true): PlanLine => ({ text, included });

/**
 * What a plan gives, as short lines for the Upgrade page. The scheduled briefs
 * come first because they are the limit readers hit; topics they follow don't
 * count against any of these.
 */
export function planLines(p: Plan): PlanLine[] {
  const schedule = dailyOffered(p)
    ? [line(`${p.dailyTopics} daily and ${p.weeklyTopics} weekly briefs`)]
    : [
        line(`${p.weeklyTopics} weekly briefs`),
        line("Daily briefs: Plus only", false),
      ];
  return [
    ...schedule,
    line(`${p.runNowPerDay} Run now a day`),
    line(`${p.publicTopics} public topics`),
    line("Follow any public topic"),
  ];
}

/**
 * What a paid plan adds over Free: only the lines that differ, then
 * "Everything else in Free".
 */
export function planGains(p: Plan): PlanLine[] {
  if (p.id === "free") return planLines(p);
  const free = new Set(planLines(PLANS.free).map((l) => l.text));
  return [
    ...planLines(p).filter((l) => !free.has(l.text)),
    line("Everything else in Free"),
  ];
}

export type Meter = { label: string; used: number; limit: number };

/**
 * The plan meters in Settings. Scheduled topics (daily only when the plan has
 * any, then weekly) and public topics are counted against the plan's caps (the
 * same numbers the Upgrade page shows); Run now comes from the database's
 * allowance. Topics the reader follows don't count.
 */
export function planMeters(input: {
  plan: string;
  daily: { used: number; limit: number };
  weekly: { used: number; limit: number };
  runsToday: { used: number; limit: number };
  publicTopics: number;
}): Meter[] {
  const plan = planFor(input.plan);
  return [
    ...(dailyOffered(plan)
      ? [
          {
            label: "Daily topics",
            used: input.daily.used,
            limit: plan.dailyTopics,
          },
        ]
      : []),
    {
      label: "Weekly topics",
      used: input.weekly.used,
      limit: plan.weeklyTopics,
    },
    {
      label: "Public topics",
      used: input.publicTopics,
      limit: plan.publicTopics,
    },
    {
      label: "Run now today",
      used: input.runsToday.used,
      limit: input.runsToday.limit,
    },
  ];
}

/**
 * The plan line under the reader's topics: the slots they will run into, e.g.
 * "2 of 3 weekly, 0 of 3 public".
 */
export function planUsage(
  p: Plan,
  used: { daily: number; weekly: number; public: number },
): string {
  return [
    ...(dailyOffered(p) ? [`${used.daily} of ${p.dailyTopics} daily`] : []),
    `${used.weekly} of ${p.weeklyTopics} weekly`,
    `${used.public} of ${p.publicTopics} public`,
  ].join(", ");
}
