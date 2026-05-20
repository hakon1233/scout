"use client";

import { useState } from "react";
import {
  Banner,
  Button,
  Field,
  KeyInput,
  validateAnthropicKey,
  validateExaKey,
} from "@/components/ui";
import type { Settings } from "@/lib/types";

type Step = 1 | 2;

type Props = {
  initial?: Settings | null;
  initialStep?: Step;
  onSave: (s: Settings) => void;
};

const SAMPLE_INTERESTS = [
  "AI safety policy",
  "Norwegian startup news",
  "SpaceX launches",
  "Climate tech funding",
  "Frontend performance",
];

function keysReadyFor(anthropic: string, exa: string) {
  return (
    validateAnthropicKey(anthropic) === null && validateExaKey(exa) === null
  );
}

export function SetupForm({ initial, initialStep = 1, onSave }: Props) {
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState(initial?.name ?? "");
  const [interestText, setInterestText] = useState(
    (initial?.interests ?? []).map((i) => i.topic).join("\n"),
  );
  const [anthropicKey, setAnthropicKey] = useState("");
  const [exaKey, setExaKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasSavedAnthropic = Boolean(initial?.anthropicKey);
  const hasSavedExa = Boolean(initial?.exaKey);

  function parseInterests() {
    return interestText
      .split(/\n|,/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((topic, i) => ({ id: `int_${i}_${topic.slice(0, 12)}`, topic }));
  }

  function submitStep1(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (parseInterests().length === 0)
      return setError("Add at least one interest (one per line).");
    setError(null);
    setStep(2);
  }

  // Empty key input on step 2 means "keep the saved value" (per PER-7h trust block).
  const effectiveAnthropic = anthropicKey || initial?.anthropicKey || "";
  const effectiveExa = exaKey || initial?.exaKey || "";
  const keysReady = keysReadyFor(effectiveAnthropic, effectiveExa);

  function submitStep2(e: React.FormEvent) {
    e.preventDefault();
    const anthropicErr = validateAnthropicKey(effectiveAnthropic);
    if (anthropicErr) return setError(anthropicErr);
    const exaErr = validateExaKey(effectiveExa);
    if (exaErr) return setError(exaErr);
    setError(null);
    onSave({
      name: name.trim(),
      interests: parseInterests(),
      anthropicKey: effectiveAnthropic.trim(),
      exaKey: effectiveExa.trim(),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption uppercase text-muted">Step {step} of 2</p>

      {step === 1 ? (
        <form onSubmit={submitStep1} className="flex flex-col gap-6">
          <div>
            <h2 className="text-title-1 text-primary">Set up your brief</h2>
            <p className="mt-2 text-body-sm text-secondary">
              Next: paste two API keys (kept on your device).
            </p>
          </div>

          {error && <Banner tone="danger">{error}</Banner>}

          <Field
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex"
            autoComplete="name"
          />

          <Field
            as="textarea"
            label={
              <>
                Interests{" "}
                <span className="text-muted">(one per line, up to 6)</span>
              </>
            }
            helper={`Try: ${SAMPLE_INTERESTS.slice(0, 3).join(", ")}.`}
            value={interestText}
            onChange={(e) => setInterestText(e.target.value)}
            placeholder={SAMPLE_INTERESTS.join("\n")}
          />

          <Button type="submit" variant="primary" className="self-start">
            Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={submitStep2} className="flex flex-col gap-6">
          <div>
            <h2 className="text-title-1 text-primary">
              Connect your providers
            </h2>
            <p className="mt-2 text-body-sm text-secondary">
              Your API keys stay in this device&apos;s local storage and are
              sent only to Anthropic and Exa.
            </p>
          </div>

          {error && <Banner tone="danger">{error}</Banner>}

          <KeyInput
            label="Anthropic API key"
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
            hasSavedValue={hasSavedAnthropic}
            value={anthropicKey}
            onChange={setAnthropicKey}
            placeholder="sk-ant-…"
          />

          <KeyInput
            label="Exa API key"
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
            hasSavedValue={hasSavedExa}
            value={exaKey}
            onChange={setExaKey}
            placeholder="…"
          />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              Back
            </Button>
            <Button type="submit" variant="primary" disabled={!keysReady}>
              Save and continue
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
