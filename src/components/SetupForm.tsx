"use client";

import { useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Field,
  KeyInput,
  validateAnthropicKey,
  validateExaKey,
} from "@/components/ui";
import { clearSettings } from "@/lib/storage";
import type { Settings } from "@/lib/types";

type Step = 1 | 2;

type Props = {
  initial?: Settings | null;
  initialStep?: Step;
  onSave: (s: Settings) => void;
  /** Wipe stored settings + last brief, then reset wizard to step 1. */
  onClearStoredKeys?: () => void;
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

// Keys are OPTIONAL: the default companion path (local `claude` CLI over the
// loopback server) needs no keys. They're only used by the browser-direct
// fetch path. So an empty key is valid; a non-empty key still must look right.
function optionalAnthropicKey(v: string): string | null {
  return v.trim() === "" ? null : validateAnthropicKey(v);
}

function optionalExaKey(v: string): string | null {
  return v.trim() === "" ? null : validateExaKey(v);
}

export function SetupForm({
  initial,
  initialStep = 1,
  onSave,
  onClearStoredKeys,
}: Props) {
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState(initial?.name ?? "");
  const [interestText, setInterestText] = useState(
    (initial?.interests ?? []).map((i) => i.topic).join("\n"),
  );
  const [anthropicKey, setAnthropicKey] = useState("");
  const [exaKey, setExaKey] = useState("");

  // Top-banner is reserved for transport/auth errors — field-level problems
  // render inline below each field.
  const [transportError, setTransportError] = useState<string | null>(null);

  const [submittedStep1, setSubmittedStep1] = useState(false);
  const [submittedStep2, setSubmittedStep2] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const hasStoredKeys = Boolean(initial?.anthropicKey || initial?.exaKey);

  // Mirror each field's validity for the disabled-on-invalid Continue button.
  const [nameErr, setNameErr] = useState<string | null>(
    validateName(initial?.name ?? ""),
  );
  const [interestsErr, setInterestsErr] = useState<string | null>(
    validateInterests(
      (initial?.interests ?? []).map((i) => i.topic).join("\n"),
    ),
  );
  const [anthropicErr, setAnthropicErr] = useState<string | null>(null);
  const [exaErr, setExaErr] = useState<string | null>(null);

  const hasSavedAnthropic = Boolean(initial?.anthropicKey);
  const hasSavedExa = Boolean(initial?.exaKey);

  // Empty key input on step 2 means "keep the saved value" (PER-7h trust block).
  const effectiveAnthropic = anthropicKey || initial?.anthropicKey || "";
  const effectiveExa = exaKey || initial?.exaKey || "";

  // Step 1 invalid if name or interests fail validation.
  const step1Invalid = nameErr !== null || interestsErr !== null;
  const step1ErrorMessage = nameErr ?? interestsErr ?? undefined;

  // Step 2 is satisfied when keys are empty (companion path) OR, if provided,
  // they look well-formed. Keys are never required to continue.
  const keysReady =
    optionalAnthropicKey(effectiveAnthropic) === null &&
    optionalExaKey(effectiveExa) === null;
  const step2Invalid = !keysReady;
  const step2ErrorMessage =
    optionalAnthropicKey(effectiveAnthropic) ??
    optionalExaKey(effectiveExa) ??
    undefined;

  const interestCount = useMemo(
    () => parseInterestLines(interestText).length,
    [interestText],
  );

  function submitStep1(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedStep1(true);
    if (step1Invalid) return;
    setTransportError(null);
    setStep(2);
  }

  function submitStep2(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedStep2(true);
    if (step2Invalid) return;
    setTransportError(null);
    const interests = parseInterestLines(interestText)
      .slice(0, MAX_INTERESTS)
      .map((topic, i) => ({ id: `int_${i}_${topic.slice(0, 12)}`, topic }));
    onSave({
      name: name.trim(),
      interests,
      anthropicKey: effectiveAnthropic.trim(),
      exaKey: effectiveExa.trim(),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption uppercase text-muted">Step {step} of 2</p>

      {step === 1 ? (
        <form onSubmit={submitStep1} className="flex flex-col gap-6" noValidate>
          <div>
            <h1 className="text-title-1 text-primary">Set up your brief</h1>
            <p className="mt-2 text-body-sm text-secondary">
              Scout runs on your local Claude Code CLI — no API keys needed.
            </p>
          </div>

          {transportError && <Banner tone="danger">{transportError}</Banner>}

          <Field
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex"
            autoComplete="name"
            validate={validateName}
            validateOn="blur"
            onValidityChange={setNameErr}
            showSubmitErrors={submittedStep1}
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
            showSubmitErrors={submittedStep1}
          />

          <div className="flex flex-col items-start gap-2">
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={step1Invalid}
              aria-disabled={step1Invalid || undefined}
              title={step1Invalid ? step1ErrorMessage : undefined}
            >
              Continue
            </Button>
            {step1Invalid && submittedStep1 && (
              <span className="text-caption text-muted" role="status">
                Fix the highlighted fields to continue.
              </span>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={submitStep2} className="flex flex-col gap-6" noValidate>
          <div>
            <h1 className="text-title-1 text-primary">
              API keys (optional)
            </h1>
            <p className="mt-2 text-body-sm text-secondary">
              Leave these blank to use the Scout companion (your local Claude
              Code CLI) — that&apos;s the default and needs no keys. Only add
              keys if you want the browser to call Anthropic and Exa directly.
              Anything you enter stays in this device&apos;s local storage.
            </p>
          </div>

          {transportError && <Banner tone="danger">{transportError}</Banner>}

          <Card tone="muted" padding="md" aria-label="How your keys are handled">
            <ul className="flex flex-col gap-2 text-caption text-secondary">
              <li className="flex gap-2">
                <span aria-hidden className="shrink-0">🔒</span>
                <span>
                  Keys are stored in this browser&apos;s{" "}
                  <code className="font-mono text-mono-xs">localStorage</code>{" "}
                  — not on any Scout server.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="shrink-0">↗</span>
                <span>
                  Requests go directly from your browser to Anthropic and Exa.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="shrink-0">🗑</span>
                <span>Clear stored keys any time below.</span>
              </li>
            </ul>
          </Card>

          {confirmClear && (
            <Banner tone="warning">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Clear stored name, interests, keys, and last brief from this
                  browser?
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
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      clearSettings();
                      setConfirmClear(false);
                      setAnthropicKey("");
                      setExaKey("");
                      setName("");
                      setInterestText("");
                      setSubmittedStep1(false);
                      setSubmittedStep2(false);
                      setTransportError(null);
                      setStep(1);
                      onClearStoredKeys?.();
                    }}
                  >
                    Clear stored keys
                  </Button>
                </span>
              </span>
            </Banner>
          )}

          <KeyInput
            label="Anthropic API key (optional)"
            helper={
              <>
                Get one at{" "}
                <a
                  className="underline"
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  console.anthropic.com
                </a>
                .
              </>
            }
            successHint="Looks like a valid Anthropic key."
            hasSavedValue={hasSavedAnthropic}
            value={anthropicKey}
            onChange={setAnthropicKey}
            placeholder="sk-ant-…"
            // Optional: blank is always fine (companion path). A non-empty key
            // is shape-checked. Saved-key-blank also stays valid.
            validate={optionalAnthropicKey}
            validateOn="blur"
            onValidityChange={setAnthropicErr}
            showSubmitErrors={submittedStep2}
          />

          <KeyInput
            label="Exa API key (optional)"
            helper={
              <>
                Get one at{" "}
                <a
                  className="underline"
                  href="https://dashboard.exa.ai/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  dashboard.exa.ai
                </a>
                .
              </>
            }
            successHint="Key length looks right."
            hasSavedValue={hasSavedExa}
            value={exaKey}
            onChange={setExaKey}
            placeholder="…"
            validate={optionalExaKey}
            validateOn="blur"
            onValidityChange={setExaErr}
            showSubmitErrors={submittedStep2}
          />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTransportError(null);
                setStep(1);
              }}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={step2Invalid}
              aria-disabled={step2Invalid || undefined}
              title={step2Invalid ? step2ErrorMessage : undefined}
            >
              Save and continue
            </Button>
            {step2Invalid && submittedStep2 && (
              <span className="text-caption text-muted" role="status">
                Fix the highlighted fields to continue.
              </span>
            )}
          </div>

          {hasStoredKeys && (
            <div className="flex items-center justify-between border-t border-border-default pt-4">
              <span className="text-caption text-muted">
                Stored on this device.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(true)}
                aria-expanded={confirmClear}
              >
                Clear stored keys
              </Button>
            </div>
          )}
        </form>
      )}
      {/* Reference unused validity state for lint-friendliness — the
          aggregate gate is computed inline above. */}
      <span hidden aria-hidden>
        {String(anthropicErr)}
        {String(exaErr)}
      </span>
    </div>
  );
}
