// Names in a sentence: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. The companion's
// and the hosted chat's replies both use it.
export function quotedList(items: readonly string[]): string {
  const quoted = items.map((t) => `"${t}"`);
  return quoted.length < 2
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}
