"use client";

import * as React from "react";
import { Field } from "./Field";

type KeyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "id" | "onChange"
> & {
  label: React.ReactNode;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  hasSavedValue?: boolean;
  value: string;
  onChange: (next: string) => void;
};

/** Trim surrounding whitespace and a pasted "Bearer " prefix. */
export function sanitizeKey(raw: string): string {
  let s = raw.trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, "");
  return s.trim();
}

export function KeyInput({
  hasSavedValue = false,
  placeholder,
  helper,
  className = "font-mono text-mono-xs",
  value,
  onChange,
  ...rest
}: KeyInputProps) {
  const [revealed, setRevealed] = React.useState(false);

  const effectivePlaceholder = hasSavedValue
    ? "Saved on this device — leave blank to keep"
    : placeholder;

  const helperWithToggle = (
    <span className="flex items-center justify-between gap-2">
      <span>{helper}</span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? "Hide key" : "Show key"}
        aria-pressed={revealed}
        className="shrink-0 rounded-md px-2 py-0.5 text-caption font-medium text-secondary outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </span>
  );

  return (
    <Field
      type={revealed ? "text" : "password"}
      autoComplete="off"
      spellCheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      className={className}
      placeholder={effectivePlaceholder}
      helper={helperWithToggle}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text");
        if (!text) return;
        e.preventDefault();
        onChange(sanitizeKey(text));
      }}
      {...rest}
    />
  );
}

/** Validator: Anthropic key shape. */
export function validateAnthropicKey(v: string): string | null {
  if (!v) return "Anthropic key is required.";
  if (!v.startsWith("sk-ant-")) return "Anthropic keys start with sk-ant-.";
  return null;
}

/** Validator: Exa key shape (length-only — server validation is out of scope). */
export function validateExaKey(v: string): string | null {
  if (!v) return "Exa key is required.";
  if (v.length < 10) return "Exa key looks too short. Paste the full key.";
  return null;
}
