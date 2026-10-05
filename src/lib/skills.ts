// Parses the canonical skill strings the Scout engine actually uses and exposes
// them as structured, titled groups for the in-development `/app/skills`
// transparency page.
//
// We import the REAL constants from the agent package source — not a copy — so
// the page stays honest as the engine evolves:
//   - SEARCH_SKILLS: the HOW-to-research rules injected verbatim into every
//     research session (recency, mandatory dates, source quality, source image).
//   - ASSEMBLY_SKILLS: the plain-language description of how findings are turned
//     into the brief (one section per interest, newest-first, honest coverage,
//     dates/source image), kept in sync with coverage.ts by hand.
//
// Both share one on-the-wire shape: a leading `## ` title line, an intro
// paragraph, then ALL-CAPS group labels ending in `:` each followed by `- `
// bullets (bullets may have indented continuation lines, e.g. a format sample).
import { SEARCH_SKILLS } from "@scout/agent/search-skills";
import { ASSEMBLY_SKILLS } from "@scout/agent/assembly-skills";

// One bullet: its main text plus any format-sample lines under it, which render
// as a small monospace block.
export type SkillBullet = { text: string; detail: string[] };
export type SkillGroup = { title: string; bullets: SkillBullet[] };
export type SkillSet = { heading: string; intro: string; groups: SkillGroup[] };

// A line is a group header when the label before its first `(` or `:` is non-empty
// and entirely upper-case (so "RECENCY (…):" and "SOURCES & QUALITY:" match, but a
// normal sentence or a bullet never does) and the line ends in a colon.
function isGroupHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.endsWith(":")) return false;
  if (/^[-*]\s/.test(trimmed)) return false;
  const label = trimmed.split(/[(:]/)[0].trim();
  return (
    label.length > 0 && /[A-Z]/.test(label) && label === label.toUpperCase()
  );
}

export function parseSkillSet(raw: string): SkillSet {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  let heading = "";
  let i = 0;
  // Title: the first `## ` line.
  for (; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      heading = m[1].trim();
      i++;
      break;
    }
  }

  // Intro: prose lines until the first group header (blank lines collapse to spaces).
  const introLines: string[] = [];
  for (; i < lines.length; i++) {
    if (isGroupHeader(lines[i])) break;
    introLines.push(lines[i]);
  }
  const intro = introLines.join(" ").replace(/\s+/g, " ").trim();

  const groups: SkillGroup[] = [];
  let current: SkillGroup | null = null;
  let bullet: SkillBullet | null = null;

  const flushBullet = () => {
    if (current && bullet) current.bullets.push(bullet);
    bullet = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isGroupHeader(line)) {
      flushBullet();
      // Drop a trailing colon for display; keep any parenthetical aside.
      current = { title: line.trim().replace(/:\s*$/, ""), bullets: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    // A top-level bullet starts a new bullet. An indented line is either the
    // bullet's wrapped prose or, from the first line that starts with markup
    // (`-`, `*`, `[`, `!`, `>`), a format sample shown as detail.
    const topBullet = /^[-*]\s+(.*)$/.exec(line);
    const isIndented = /^\s+\S/.test(line);
    const trimmed = line.trim();
    if (topBullet && !isIndented) {
      flushBullet();
      bullet = { text: topBullet[1].trim(), detail: [] };
    } else if (bullet && trimmed !== "") {
      if (bullet.detail.length === 0 && !/^[-*[!>]/.test(trimmed)) {
        bullet.text += ` ${trimmed}`;
      } else {
        bullet.detail.push(trimmed);
      }
    }
  }
  flushBullet();

  return { heading, intro, groups };
}

export const RESEARCH_SKILLS: SkillSet = parseSkillSet(SEARCH_SKILLS);
export const ARTICLE_ASSEMBLY_SKILLS: SkillSet = parseSkillSet(ASSEMBLY_SKILLS);
