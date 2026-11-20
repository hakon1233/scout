// Fills the business starter pack (business-starter-data.ts) for one reader:
// their trade and kommune in, each ready-made topic's title and intent doc
// out. Pure; the sign-up step creates the topics.

import {
  KOMMUNER,
  TEMPLATES,
  TRADES,
  type Trade,
} from "./business-starter-data";

export { TRADES, type Trade };

export type Kommune = { number: string; name: string };

export type StarterTopic = { id: string; topic: string; doc: string };

export const KOMMUNE_LIST: Kommune[] = KOMMUNER.trim()
  .split("\n")
  .map((line) => {
    const [number, ...name] = line.trim().split(" ");
    return { number, name: name.join(" ") };
  });

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The kommune whose name is `text` (any case), or null. */
export function findKommune(text: string | null | undefined): Kommune | null {
  if (!text) return null;
  const want = fold(text);
  return KOMMUNE_LIST.find((k) => fold(k.name) === want) ?? null;
}

export function findTrade(id: string): Trade | null {
  return TRADES.find((t) => t.id === id) ?? null;
}

/**
 * Replaces each {name} in `template` with vars[name]. A var may itself hold
 * a {name}, so it fills twice. Throws on a name with no var: a template and
 * its trades must agree.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const once = (s: string) =>
    s.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
      if (!(name in vars)) throw new Error(`No value for {${name}}`);
      return vars[name];
    });
  // An empty optional line (e.g. no local rules) leaves no gap.
  return once(once(template))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The trade's ready-made topics for a business in `kommune`. */
export function starterTopics(trade: Trade, kommune: Kommune): StarterTopic[] {
  const vars = {
    ...trade.vars,
    kommune: kommune.name.replace(/ \(.*\)$/, ""),
    kommunenummer: kommune.number,
  };
  return trade.topics.map((id) => ({
    id,
    topic: fillTemplate(TEMPLATES[id].topic, vars),
    doc: fillTemplate(TEMPLATES[id].doc, vars),
  }));
}
