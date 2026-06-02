"use client";

import { useMemo, useState } from "react";
import { Banner, Button, Field } from "@/components/ui";
import { clearSettings } from "@/lib/storage";
import type { Settings } from "@/lib/types";

type Props = {
  initial?: Settings | null;
  onSave: (s: Settings) => void;
  /** Wipe stored settings + last brief, then reset the form. */
  onClearStored?: () => void;
};

const SAMPLE_INTERESTS = [
  "AI safety policy",
  "Norwegian startup news",
  "SpaceX launches",
  "Climate tech funding",
  "Frontend performance",
];

const MAX_INTERESTS = 6;

function parseInterestLines(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function validateName(v: string): string | null {
  if (!v.trim()) return "Please enter your name.";
  return null;
}

function validateInterests(v: string): string | null {
  const lines = parseInterestLines(v);
  if (lines.length < 1) return "Add at least one interest.";
  if (lines.length > MAX_INTERESTS)
    return `Keep it to ${MAX_INTERESTS} or fewer — pick the ones you care about most.`;
  return null;
}

// Scout generates briefs only through the local companion (your `claude` CLI
// over the loopback server) — there are no API keys to collect (PER-109/PER-133
// removed the browser-direct fetch path), so setup is a single step.
export function SetupForm({ initial, onSave, onClearStored }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [interestText, setInterestText] = useState(
    (initial?.interests ?? []).map((i) => i.topic).join("\n"),
  );

  const [submitted, setSubmitted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const hasStored = Boolean(initial);

  // Mirror each field's validity for the disabled-on-invalid Continue button.
  const [nameErr, setNameErr] = useState<string | null>(
    validateName(initial?.name ?? ""),
  );
  const [interestsErr, setInterestsErr] = useState<string | null>(
    validateInterests(
      (initial?.interests ?? []).map((i) => i.topic).join("\n"),
    ),
  );

  const formInvalid = nameErr !== null || interestsErr !== null;
  const errorMessage = nameErr ?? interestsErr ?? undefined;

  const interestCount = useMemo(
    () => parseInterestLines(interestText).length,
    [interestText],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (formInvalid) return;
    const interests = parseInterestLines(interestText)
      .slice(0, MAX_INTERESTS)
      .map((topic, i) => ({ id: `int_${i}_${topic.slice(0, 12)}`, topic }));
    onSave({ name: name.trim(), interests });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <div>
          <h1 className="text-title-1 text-primary">Set up your brief</h1>
          <p className="mt-2 text-body-sm text-secondary">
            Scout runs on your local Claude Code CLI — no API keys needed.
          </p>
        </div>

        <Field
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex"
          autoComplete="name"
          validate={validateName}
          validateOn="blur"
          onValidityChange={setNameErr}
          showSubmitErrors={submitted}
        />

        <Field
          as="textarea"
          label={
            <>
              Interests{" "}
              <span className="text-muted">
                (one per line, up to {MAX_INTERESTS})
              </span>
            </>
          }
          helper={
            <>
              <span className="font-medium text-secondary">
                {interestCount} / {MAX_INTERESTS}
              </span>
              {interestCount === 0 ? (
                <> · try: {SAMPLE_INTERESTS.slice(0, 3).join(", ")}.</>
              ) : null}
            </>
          }
          value={interestText}
          onChange={(e) => setInterestText(e.target.value)}
          placeholder={SAMPLE_INTERESTS.join("\n")}
          validate={validateInterests}
          validateOn="change"
          onValidityChange={setInterestsErr}
          showSubmitErrors={submitted}
        />

        <div className="flex flex-col items-start gap-2">
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={formInvalid}
            aria-disabled={formInvalid || undefined}
            title={formInvalid ? errorMessage : undefined}
          >
            {hasStored ? "Save" : "Continue"}
          </Button>
          {formInvalid && submitted && (
            <span className="text-caption text-muted" role="status">
              Fix the highlighted fields to continue.
            </span>
          )}
        </div>
      </form>

      {confirmClear && (
        <Banner tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Clear stored name, interests, and last brief from this browser?
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  clearSettings();
                  setConfirmClear(false);
                  setName("");
                  setInterestText("");
                  setSubmitted(false);
                  onClearStored?.();
                }}
              >
                Clear stored data
              </Button>
            </span>
          </span>
        </Banner>
      )}

      {hasStored && onClearStored && !confirmClear && (
        <div className="flex items-center justify-between border-t border-border-default pt-4">
          <span className="text-caption text-muted">
            Stored on this device.
          </span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setConfirmClear(true)}
            aria-expanded={confirmClear}
          >
            Clear stored data
          </Button>
        </div>
      )}
    </div>
  );
}
