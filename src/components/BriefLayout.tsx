"use client";

import * as React from "react";
import { BriefView } from "@/components/BriefView";
import { Banner, Button, Card } from "@/components/ui";
import type { Brief } from "@/lib/types";

type Props = {
  brief: Brief;
  name: string;
  running?: boolean;
  preview?: boolean;
  onRegenerate?: () => void;
  onEditInterests?: () => void;
  // PER-146: when a previous edition exists in State LATEST, show a low-emphasis
  // recovery link (header + footer). `prevDate` is the formatted filed date of
  // that previous edition. Omitted ⇒ no previous ⇒ no affordance shown.
  onViewPrevious?: () => void;
  prevDate?: string;
};

export function BriefLayout({
  brief,
  name,
  running = false,
  preview = false,
  onRegenerate,
  onEditInterests,
  onViewPrevious,
  prevDate,
}: Props) {
  const generated = new Date(brief.generatedAt);
  const dateLabel = generated.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = generated.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const topicCount = brief.interests.length;
  const articleCount = brief.articles.length;

  const hasPrevious = Boolean(onViewPrevious && prevDate);

  // No founder name set ⇒ fall back to "Your brief" rather than rendering the
  // empty-possessive "'s brief" (PER-186 defect 2). The possessive only reads
  // right when there's actually a name to own it.
  const trimmedName = name.trim();
  const ownerLabel = trimmedName ? `${trimmedName}'s brief` : "Your brief";

  return (
    <article
      aria-label={`${ownerLabel} — ${dateLabel}`}
      className="flex flex-col gap-6"
    >
      <header className="measure-prose flex flex-col gap-1">
        <p className="text-caption uppercase tracking-wide text-muted">
          Generated {dateLabel} · {timeLabel}
        </p>
        {hasPrevious && (
          <Button
            variant="link"
            size="sm"
            className="self-start"
            onClick={onViewPrevious}
          >
            ← View previous edition · filed {prevDate}
          </Button>
        )}
        <h1 className="text-title-1 text-primary">
          {ownerLabel} — {dateLabel}
        </h1>
        {hasPrevious && (
          <p className="text-caption text-muted">
            Scout keeps your current and previous edition.
          </p>
        )}
      </header>

      <div className="measure-prose w-full">
        <Banner tone="info">
          Searched {topicCount} topic{topicCount === 1 ? "" : "s"} ·{" "}
          {articleCount} article{articleCount === 1 ? "" : "s"} · deduped to{" "}
          {articleCount}
        </Banner>
      </div>

      <Card tone="default" padding="lg">
        <div className="measure-prose">
          <BriefView brief={brief} />
        </div>
      </Card>

      {!preview && (
        <Card
          tone="muted"
          padding="md"
          className="measure-prose flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <p className="text-body-sm font-medium text-primary">End of brief</p>
            <p className="text-caption text-muted">
              Want fresher items or different topics?
            </p>
          </div>
          <div className="flex flex-col gap-2 min-[480px]:flex-row">
            {hasPrevious && (
              <Button variant="link" size="sm" onClick={onViewPrevious}>
                ← View previous edition · filed {prevDate}
              </Button>
            )}
            <Button variant="link" onClick={onEditInterests}>
              Edit interests
            </Button>
            <Button
              variant="secondary"
              loading={running}
              onClick={onRegenerate}
            >
              {running ? "Working…" : "Run now"}
            </Button>
          </div>
        </Card>
      )}
    </article>
  );
}
