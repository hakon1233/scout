"use client";

import { AppNav } from "@/components/AppNav";
import { SkillSection } from "@/components/skills/SkillSection";
import { ARTICLE_ASSEMBLY_SKILLS, RESEARCH_SKILLS } from "@/lib/skills";

// In-development transparency page (PER-212): shows the REAL general skills Scout
// uses to (a) research the news and (b) assemble your brief. The content is parsed
// from the engine's own canonical strings (search-skills.ts / assembly-skills.ts),
// so it stays honest as the engine evolves — it is not a hand-kept marketing list.
// The section renderer is shared with the interests workbench (PER-233), which
// surfaces the same Skills setup inside its big left pane.

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
