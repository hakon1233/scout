// A fake hosted backend for screenshots and e2e only: an in-memory Supabase
// auth client and an in-memory HostedData with realistic topics and a brief.
// On only when NEXT_PUBLIC_SCOUT_FAKE_HOSTED=1 and NODE_ENV isn't
// "production"; next.config.ts also refuses a production build with the flag
// set. Nothing here touches the network.
//
// Only types come from auth.ts and hosted.ts (both call in here), so there is
// no import cycle at runtime.

import {
  DEFAULT_BRIEF_SETTINGS,
  parseBriefSettings,
  type BriefSettings,
  type ChatTurn,
} from "@scout/core";
import type { AuthClient } from "./auth";
import type {
  Cadence,
  HostedData,
  HostedHome,
  HostedInterest,
  PushState,
} from "./hosted";
import type { Article, Brief } from "./types";

/** True only in a dev or test server started with the fake flag. */
export function fakeHostedOn(
  env: Record<string, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SCOUT_FAKE_HOSTED: process.env.NEXT_PUBLIC_SCOUT_FAKE_HOSTED,
  },
): boolean {
  return (
    env.NODE_ENV !== "production" && env.NEXT_PUBLIC_SCOUT_FAKE_HOSTED === "1"
  );
}

export const FAKE_CONFIG = { url: "http://fake.invalid", anonKey: "fake" };

const USER = { id: "fake-reader", email: "reader@example.com" };
const SIGNED_OUT = "scout.fake.signedOut";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The Supabase auth slice, signed in as one reader until signOut. */
export function createFakeAuthClient(): AuthClient {
  const listeners = new Set<
    (event: string, session: { user: typeof USER } | null) => void
  >();
  const session = () =>
    storage()?.getItem(SIGNED_OUT) === "1"
      ? null
      : { user: USER, access_token: "fake-token" };
  const signIn = async () => {
    storage()?.removeItem(SIGNED_OUT);
    listeners.forEach((l) => l("SIGNED_IN", session()));
    return { error: null };
  };
  return {
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: session() }, error: null }),
    signInWithOAuth: signIn,
    signInWithOtp: signIn,
    async signOut() {
      storage()?.setItem(SIGNED_OUT, "1");
      listeners.forEach((l) => l("SIGNED_OUT", null));
      return { error: null };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return {
        data: {
          subscription: { unsubscribe: () => listeners.delete(callback) },
        },
      };
    },
  };
}

const day = (offset: number, hour = 7) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(hour, 2, 0, 0);
  return d.toISOString();
};

function interest(
  p: Pick<HostedInterest, "id" | "topic"> & Partial<HostedInterest>,
): HostedInterest {
  return {
    cadence: "daily",
    settings: { ...DEFAULT_BRIEF_SETTINGS },
    following: false,
    visibility: "private",
    shareSlug: null,
    run: null,
    updatedAt: day(0),
    failed: null,
    ownerName: null,
    team: false,
    ...p,
  };
}

const POWER = "Nordic power prices and the NO3 area";
const LLAMA = "r/LocalLLaMA: new open models and benchmarks";
const RUST = "Rust releases and the async working group";
const NTNU = "NTNU and Trondheim events";

function seedInterests(): HostedInterest[] {
  return [
    interest({
      id: "power",
      topic: POWER,
      visibility: "shared",
      shareSlug: "no3-power-prices",
    }),
    interest({
      id: "llama",
      topic: LLAMA,
      settings: {
        ...DEFAULT_BRIEF_SETTINGS,
        length: "short",
        stories: "relevant",
      },
      updatedAt: day(1),
    }),
    interest({
      id: "rust",
      topic: RUST,
      cadence: "weekly",
      visibility: "public",
      shareSlug: "rust-releases",
      settings: { ...DEFAULT_BRIEF_SETTINGS, length: "long", stories: 3 },
      updatedAt: day(4),
      failed: "The last run stopped before it finished.",
    }),
    interest({
      id: "ntnu",
      topic: NTNU,
      following: true,
      visibility: "public",
      ownerName: "Ingrid",
      updatedAt: day(0, 6),
    }),
  ];
}

function article(
  id: string,
  topic: string,
  daysAgo: number,
  title: string,
  url: string,
  text: string,
): Article {
  return {
    id: `fake-brief-${id}`,
    title,
    url,
    text,
    interest: topic,
    publishedAt: day(daysAgo, 9),
  };
}

function seedBrief(): Brief {
  const articles = [
    article(
      "s1",
      POWER,
      0,
      "NO3 day-ahead price hits 142 øre/kWh",
      "https://www.nordpoolgroup.com/en/market-data/no3",
      "Cold, still weather pushed Thursday’s Trondheim-area price to its highest since February, while the system price stayed near 88 øre.",
    ),
    article(
      "s2",
      POWER,
      1,
      "Statnett expects imports on cold weekdays",
      "https://www.statnett.no/en/news/winter-outlook",
      "Mid-Norway will lean on Swedish imports this winter; Statnett asks large users to plan load they can move.",
    ),
    article(
      "s3",
      LLAMA,
      1,
      "A 30B open model runs at 40 tokens/s on one RTX 5090",
      "https://www.reddit.com/r/LocalLLaMA/comments/fake30b",
      "A popular thread compares 4-bit and 6-bit quants; the 4-bit build keeps most of its coding score at half the memory.",
    ),
    article(
      "s4",
      LLAMA,
      2,
      "llama.cpp server gains speculative decoding",
      "https://github.com/ggml-org/llama.cpp/releases",
      "The new flag pairs a small draft model with a large one; users report 1.5–2× faster replies on long answers.",
    ),
    article(
      "s5",
      NTNU,
      1,
      "Ocean Space Lab opens with a public day on 28 Nov",
      "https://www.ntnu.edu/news/ocean-space-lab",
      "NTNU opens the new lab at Tyholt to everyone from 11:00 to 16:00, with tours of the towing tank and drone demos.",
    ),
    article(
      "s6",
      NTNU,
      2,
      "Kosmorama winter programme: student prices on Tuesdays",
      "https://www.kosmorama.no/winter",
      "Trondheim Kino lists the winter programme; tickets are 90 kr for students every Tuesday until March.",
    ),
  ];
  return {
    id: "fake-brief",
    generatedAt: day(0),
    interests: [POWER, LLAMA, RUST, NTNU],
    articles,
    markdown: "",
  };
}

const reply = (message: string, text: string): ChatTurn => ({
  id: `fake-turn-${Math.random().toString(36).slice(2)}`,
  created_at: new Date().toISOString(),
  status: "ready",
  message,
  reply: text,
  changes: [],
});

/** An in-memory HostedData: edits stick until the page reloads. */
export function createFakeHostedData(): HostedData {
  let interests = seedInterests();
  const brief = seedBrief();
  const removed = new Map<string, HostedInterest>();
  const pushOn = new Set<string>();
  let device: PushState = "off";
  let timeZone: string | null = "Europe/Oslo";
  const turns: ChatTurn[] = [];

  const find = (id: string) => {
    const i = interests.find((x) => x.id === id);
    if (!i) throw new Error("Scout no longer has this topic.");
    return i;
  };
  const patch = (id: string, change: Partial<HostedInterest>) => {
    find(id);
    interests = interests.map((i) => (i.id === id ? { ...i, ...change } : i));
  };
  const count = (c: Cadence) =>
    interests.filter((i) => !i.following && i.cadence === c).length;

  return {
    async home(): Promise<HostedHome> {
      return {
        interests: interests.map((i) => ({ ...i })),
        brief,
        allowance: {
          plan: "free",
          daily: { used: count("daily"), limit: 2 },
          weekly: { used: count("weekly"), limit: 3 },
          runsToday: { used: 1, limit: 3 },
        },
        isAdmin: false,
        notices: [],
      };
    },
    transcript: async () => [...turns],
    async chat(message) {
      const turn = reply(message, "This preview can't set up topics.");
      turns.push(turn);
      return turn;
    },
    confirm: async () => reply("", "Done."),
    async setCadence(id, cadence) {
      patch(id, { cadence });
    },
    async setBriefSettings(id, change) {
      const parsed = parseBriefSettings(change);
      if (!parsed.ok) throw new Error(parsed.error);
      const settings: BriefSettings = { ...find(id).settings, ...change };
      patch(id, { settings });
    },
    async remove(id) {
      removed.set(id, find(id));
      interests = interests.filter((i) => i.id !== id);
    },
    async restore(id) {
      const back = removed.get(id);
      if (back) interests = [...interests, back];
      removed.delete(id);
    },
    async unfollow(id) {
      interests = interests.filter((i) => i.id !== id);
    },
    async runNow(id) {
      patch(id, { run: "queued" });
      setTimeout(() => patch(id, { run: null, updatedAt: day(0) }), 3_000);
    },
    async setVisibility(id, visibility) {
      const slug = visibility === "private" ? null : `${id}-link`;
      patch(id, { visibility, shareSlug: slug });
      return slug;
    },
    shared: async () => null,
    async follow() {
      throw new Error("Following isn't available in this preview.");
    },
    async hostCopy() {
      throw new Error("Not available in this preview.");
    },
    dismiss: async () => undefined,
    timeZone: async () => timeZone,
    async setTimeZone(zone) {
      timeZone = zone;
    },
    topicPush: async () => [...pushOn],
    async setTopicPush(id, on) {
      if (on) pushOn.add(id);
      else pushOn.delete(id);
    },
    async deleteAccount() {
      interests = [];
    },
    pushStatus: async () => device,
    async pushEnable() {
      return (device = "on");
    },
    async pushDisable() {
      return (device = "off");
    },
  };
}
