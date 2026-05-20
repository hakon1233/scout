"use client";

import { useState } from "react";
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
    (initial?.interests ?? [])
      .map((i) => i.topic)
      .join("\n"),
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
        <h2 className="text-2xl font-semibold tracking-tight">
          Set up your brief
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          MVP runs entirely in your browser. Your API keys stay in this device&apos;s
          local storage and are sent only to Anthropic and Exa.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Your name</span>
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex"
          autoComplete="name"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Interests <span className="text-zinc-500">(one per line, up to 6)</span>
        </span>
        <textarea
          className="min-h-32 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
          value={interestText}
          onChange={(e) => setInterestText(e.target.value)}
          placeholder={SAMPLE_INTERESTS.join("\n")}
        />
        <span className="text-xs text-zinc-500">
          Try: {SAMPLE_INTERESTS.slice(0, 3).join(", ")}.
        </span>
      </label>

      <fieldset className="flex flex-col gap-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          API keys (MVP — stored locally)
        </legend>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Anthropic API key</span>
          <input
            type="password"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-zinc-500">
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
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Exa API key</span>
          <input
            type="password"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            value={exaKey}
            onChange={(e) => setExaKey(e.target.value)}
            placeholder="…"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-zinc-500">
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
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Save and continue
      </button>
    </form>
  );
}
