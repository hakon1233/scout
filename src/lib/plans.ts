// The plans Scout offers, in one place. The Upgrade page, the Settings plan
// meters and the menu's plan line all read from here; the database's own
// limits (rpc/allowance) stay the truth for what a reader has used.
//
// Prices are placeholders until payments go live (Vipps first, card by Stripe
// second). Change the numbers here and every screen follows.

export type PlanId = "free" | "plus";

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price as shown, Norwegian kroner first. */
  price: string;
  /** The same price for readers outside Norway, or null when free. */
  priceAbroad: string | null;
  topics: number;
  dailyTopics: number;
  weeklyTopics: number;
  runNowPerDay: number;
  publicTopics: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: "0 kr",
    priceAbroad: null,
    topics: 5,
    dailyTopics: 2,
    weeklyTopics: 3,
    runNowPerDay: 3,
    publicTopics: 3,
  },
  plus: {
    id: "plus",
    name: "Plus",
    price: "49 kr a month",
    priceAbroad: "About $5 a month",
    topics: 20,
    dailyTopics: 20,
    weeklyTopics: 0,
    runNowPerDay: 10,
    publicTopics: 3,
  },
};

/** The plan for a name the database reports, Free when it is unknown. */
export function planFor(name: string | null | undefined): Plan {
  return name === "plus" ? PLANS.plus : PLANS.free;
}

/** What a plan gives, as short lines for the Upgrade page. */
export function planLines(p: Plan): string[] {
  const schedule =
    p.weeklyTopics === 0
      ? "all daily"
      : `${p.dailyTopics} daily, ${p.weeklyTopics} weekly`;
  return [
    `${p.topics} topics (${schedule})`,
    `${p.runNowPerDay} Run now a day`,
    `${p.publicTopics} public topics`,
    "Follow any public topic",
  ];
}

export type Meter = { label: string; used: number; limit: number };

/**
 * The plan meters in Settings. Topics and Run now come from the database's
 * allowance; public topics are counted from the reader's own topics against
 * the plan's cap. Topics the reader follows don't count.
 */
export function planMeters(input: {
  plan: string;
  daily: { used: number; limit: number };
  weekly: { used: number; limit: number };
  runsToday: { used: number; limit: number };
  ownTopics: number;
  publicTopics: number;
}): Meter[] {
  const plan = planFor(input.plan);
  return [
    {
      label: "Topics",
      used: input.ownTopics,
      limit: input.daily.limit + input.weekly.limit,
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
