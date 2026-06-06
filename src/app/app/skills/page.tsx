"use client";

import * as React from "react";
import { AppNav } from "@/components/AppNav";
import { Card } from "@/components/ui";
import {
  ARTICLE_ASSEMBLY_SKILLS,
  RESEARCH_SKILLS,
  type SkillBullet,
  type SkillSet,
} from "@/lib/skills";

// In-development transparency page (PER-212): shows the REAL general skills Scout
// uses to (a) research the news and (b) assemble your brief. The content is parsed
// from the engine's own canonical strings (search-skills.ts / assembly-skills.ts),
// so it stays honest as the engine evolves — it is not a hand-kept marketing list.

// Render a line with `backtick` code spans as <code>. Everything else is plain
// text. (The source strings only use inline code + plain prose — no other markup.)
function withCode(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split("`").map((part, idx) =>
    idx % 2 === 1 ? (
      <code
        key={`${keyPrefix}-c${idx}`}
        className="rounded bg-surface-muted px-1 py-0.5 font-mono text-mono-xs text-primary"
      >
        {part}
      </code>
    ) : (
      <React.Fragment key={`${keyPrefix}-t${idx}`}>{part}</React.Fragment>
    ),
  );
}

function Bullet({ bullet, idx }: { bullet: SkillBullet; idx: number }) {
  return (
    <li className="flex gap-2.5 text-body-sm leading-relaxed text-secondary">
      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
      <span className="flex flex-col gap-1">
        <span>{withCode(bullet.text, `b${idx}`)}</span>
        {bullet.detail.length > 0 && (
          <span className="mt-1 block whitespace-pre-wrap rounded-md bg-surface-muted px-3 py-2 font-mono text-mono-xs text-muted">
            {bullet.detail.map((d, di) => (
              <span key={`b${idx}-d${di}`} className="block">
                {withCode(d, `b${idx}-d${di}`)}
              </span>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function SkillSection({ set }: { set: SkillSet }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-[24px] leading-tight text-primary">
          {set.heading}
        </h2>
        {set.intro && <p className="text-body-sm text-muted">{set.intro}</p>}
      </div>
      <div className="flex flex-col gap-3">
        {set.groups.map((group, gi) => (
          <Card key={group.title} padding="md">
            <p className="mb-3 font-mono text-caption uppercase tracking-[0.08em] text-signal">
              {group.title}
            </p>
            <ul className="flex flex-col gap-3">
              {group.bullets.map((bullet, bi) => (
                <Bullet key={`${gi}-${bi}`} bullet={bullet} idx={gi * 100 + bi} />
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function SkillsPage() {
  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <AppNav />

        <header className="flex flex-col gap-3 border-b border-border-default pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption uppercase text-muted">Scout · under the hood</p>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-signal/40 bg-signal/10 px-2.5 py-0.5 font-mono text-mono-xs uppercase tracking-[0.06em] text-signal">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
              In development
            </span>
          </div>
          <h1 className="font-serif text-[32px] leading-tight text-primary sm:text-[40px]">
            Scout&apos;s skills
          </h1>
          <p className="max-w-prose text-body text-secondary">
            A look at the general skills Scout applies to every brief — how it
            researches the news, and how it assembles what it finds into the brief
            you read. These are the engine&apos;s real working rules, shown straight
            from the source, not a marketing summary. This page is a development-phase
            preview and may change as the engine improves.
          </p>
        </header>

        <SkillSection set={RESEARCH_SKILLS} />
        <SkillSection set={ARTICLE_ASSEMBLY_SKILLS} />

        <p className="border-t border-border-default pt-5 text-caption text-muted">
          These skills apply to every interest equally — they govern how news is
          found and presented, while your interests decide what Scout looks for.
        </p>
      </div>
    </main>
  );
}
