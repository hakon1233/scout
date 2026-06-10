"use client";

import * as React from "react";
import { Card } from "@/components/ui";
import type { SkillBullet, SkillSet } from "@/lib/skills";

// Shared renderer for the engine's canonical skill sets (PER-212). Extracted
// from the standalone /app/skills page so the consolidated interests workbench
// (PER-233) can surface the same Skills setup UI without duplicating it. The
// content is parsed from the engine's own strings (search-skills.ts /
// assembly-skills.ts), so it stays honest as the engine evolves.

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

export function SkillSection({ set }: { set: SkillSet }) {
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
