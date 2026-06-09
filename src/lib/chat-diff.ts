// Tiny line diff for the chat action cards (PER-228 chunk 5). Not a full LCS —
// it trims the common prefix/suffix and renders the changed middle as removed-
// then-added lines. Good enough to show "what this change did" in a doc card
// without pulling in a diff library. Capped so a full-doc rewrite doesn't render
// hundreds of gutter rows.

export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

const MAX_LINES = 40;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");

  // Common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // Common suffix (not overlapping the prefix).
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = start; i <= endA; i++) out.push({ kind: "del", text: a[i] });
  for (let i = start; i <= endB; i++) out.push({ kind: "add", text: b[i] });

  // If nothing changed in the middle (e.g. identical), surface a tiny context
  // line so the card isn't empty.
  if (out.length === 0) {
    const sample = (after || before).replace(/\n$/, "").split("\n")[0] ?? "";
    if (sample) out.push({ kind: "ctx", text: sample });
  }

  if (out.length > MAX_LINES) {
    const head = out.slice(0, MAX_LINES);
    head.push({ kind: "ctx", text: `… ${out.length - MAX_LINES} more lines` });
    return head;
  }
  return out;
}
