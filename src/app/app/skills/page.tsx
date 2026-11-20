"use client";

import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SkillSection } from "@/components/skills/SkillSection";
import { ARTICLE_ASSEMBLY_SKILLS, RESEARCH_SKILLS } from "@/lib/skills";

// In-development transparency page: shows the REAL general skills Scout
// uses to (a) research the news and (b) assemble your brief. The content is parsed
// from the engine's own canonical strings (search-skills.ts / assembly-skills.ts),
// so it stays honest as the engine evolves — it is not a hand-kept marketing list.
// The section renderer is shared with the interests workbench, which
// surfaces the same Skills setup inside its big left pane.

export default function SkillsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Scout's skills"
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        <span className="font-medium text-warning">In development</span> · The
        engine&apos;s real rules for researching the news and writing your
        brief, shown straight from the source.
      </PageHeader>
      <div className="flex flex-col gap-8" data-main>
        <SkillSection set={RESEARCH_SKILLS} />
        <SkillSection set={ARTICLE_ASSEMBLY_SKILLS} />

        <p className="border-t border-border-default pt-5 text-caption text-muted">
          These skills apply to every topic equally. They govern how news is
          found and presented, while your topics decide what Scout looks for.
        </p>
      </div>
    </AppShell>
  );
}
