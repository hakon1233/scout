"use client";

import { useState } from "react";
import { Banner, Button, Card, Field } from "@/components/ui";
import type { Settings } from "@/lib/types";

type Props = {
  initial?: Settings | null;
  onSave: (s: Settings) => void;
};

const SAMPLE_INTERESTS = [
  "AI safety policy",
  "Norwegian startup news",
  "SpaceX launches",
  "Climate tech funding",
  "Frontend performance",
];

export function SetupForm({ initial, onSave }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [interestText, setInterestText] = useState(
    (initial?.interests ?? []).map((i) => i.topic).join("\n"),
  );
  const [anthropicKey, setAnthropicKey] = useState(initial?.anthropicKey ?? "");
  const [exaKey, setExaKey] = useState(initial?.exaKey ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const interests = interestText
      .split(/\n|,/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((topic, i) => ({ id: `int_${i}_${topic.slice(0, 12)}`, topic }));

    if (!name.trim()) return setError("Please enter your name.");
    if (interests.length === 0)
      return setError("Add at least one interest (one per line).");
    if (!anthropicKey.startsWith("sk-ant-"))
      return setError("Anthropic key should start with sk-ant-.");
    if (exaKey.trim().length < 10)
      return setError("Exa key looks too short. Paste your full key.");

    setError(null);
    onSave({
      name: name.trim(),
      interests,
      anthropicKey: anthropicKey.trim(),
      exaKey: exaKey.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div>
        <h2 className="text-title-1 text-primary">Set up your brief</h2>
        <p className="mt-2 text-body-sm text-secondary">
          MVP runs entirely in your browser. Your API keys stay in this
          device&apos;s local storage and are sent only to Anthropic and Exa.
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

      <Card padding="md" tone="default">
        <p className="mb-3 text-caption font-medium uppercase text-muted">
          API keys (MVP — stored locally)
        </p>
        <div className="flex flex-col gap-4">
          <Field
            type="password"
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
            className="font-mono text-mono-xs"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
          />
          <Field
            type="password"
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
            className="font-mono text-mono-xs"
            value={exaKey}
            onChange={(e) => setExaKey(e.target.value)}
            placeholder="…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </Card>

      <Button type="submit" variant="primary" className="self-start">
        Save and continue
      </Button>
    </form>
  );
}
