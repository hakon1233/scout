"use client";

import Link from "next/link";
import * as React from "react";
import { TagPicker, useTagCounts } from "@/components/TagPicker";
import { AppSkeleton } from "@/components/AppSkeleton";
import { Button, SettingsGroup, Toggle, buttonClasses } from "@/components/ui";
import { hostedAuth } from "@/lib/auth";
import { HostedError, type HostedData, type Profile } from "@/lib/hosted";

// The hosted profile: optional, private fields Scout uses only to pick topics
// for the reader. Each field saves as it changes (text on leaving the field
// or Enter); a refusal keeps what was typed and says why under the field.

export const MAX_LIKED_TAGS = 10;

const EMPTY: Profile = {
  displayName: null,
  location: null,
  student: null,
  role: null,
  likedTags: [],
};

type Load =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; profile: Profile };

type TextField = "displayName" | "location" | "role";

export function HostedProfile({ data }: { data: HostedData }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [status, setStatus] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const [cleared, setCleared] = React.useState<Profile | null>(null);
  const counts = useTagCounts(data);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const user = await hostedAuth()
        ?.currentUser()
        .catch(() => null);
      if (!live) return;
      if (!user) return setLoad({ kind: "signed-out" });
      try {
        const profile = await data.profile();
        if (live) setLoad({ kind: "ready", profile });
      } catch (err) {
        if (!live) return;
        setLoad(
          err instanceof HostedError && err.kind === "signed-out"
            ? { kind: "signed-out" }
            : { kind: "failed", message: "Couldn't load your profile." },
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [data, attempt]);

  React.useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 10_000);
    return () => clearTimeout(timer);
  }, [cleared]);

  if (load.kind === "loading") return <AppSkeleton />;
  if (load.kind === "signed-out")
    return (
      <div className="flex flex-col items-start gap-3" data-main>
        <p className="text-body text-secondary">
          Sign in to fill in your profile.
        </p>
        <Link href="/app/signin/" className={buttonClasses("primary", "sm")}>
          Sign in
        </Link>
      </div>
    );
  if (load.kind === "failed")
    return (
      <div className="flex flex-col items-start gap-3" data-main>
        <p role="alert" className="text-body text-danger">
          {load.message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLoad({ kind: "loading" });
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );

  const profile = load.profile;

  async function save(change: Partial<Profile>, field: string) {
    const before = profile;
    setLoad({ kind: "ready", profile: { ...profile, ...change } });
    setStatus("Saving…");
    setErrors(({ [field]: _, ...rest }) => rest);
    try {
      await data.setProfile(change);
      setStatus("Saved");
    } catch (err) {
      setStatus(null);
      const message =
        err instanceof HostedError
          ? err.message
          : "Couldn't save that. Try again.";
      setErrors((e) => ({ ...e, [field]: message }));
      // Toggles and tags go back; text keeps what was typed (TextRow).
      if (!(field in TEXT_LABELS)) setLoad({ kind: "ready", profile: before });
    }
  }

  async function clearAll() {
    const before = profile;
    await save({ ...EMPTY }, "clear");
    setCleared(before);
  }

  return (
    <div className="flex flex-col gap-8" data-main>
      <p className="-mt-2 text-body-sm text-secondary text-pretty">
        Optional and private. Scout uses it only to pick topics for you. Nobody
        else sees it.
      </p>

      <SettingsGroup title="About you">
        {(Object.keys(TEXT_LABELS) as TextField[]).map((field) => (
          <TextRow
            key={field}
            field={field}
            value={profile[field] ?? ""}
            error={errors[field] ?? null}
            onSave={(v) => void save({ [field]: v || null }, field)}
          />
        ))}
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-body-sm text-primary">Student</span>
            <span className="text-caption text-muted">
              Picks student prices, housing and campus news
            </span>
          </div>
          <Toggle
            label="Student"
            checked={profile.student === true}
            onChange={(on) => void save({ student: on }, "student")}
          />
        </div>
      </SettingsGroup>

      <section className="flex flex-col gap-2" aria-labelledby="profile-likes">
        <h2
          id="profile-likes"
          className="px-1 text-body-sm font-medium text-secondary"
        >
          What you like
        </h2>
        <div className="rounded-card border border-border-default bg-surface p-4">
          <TagPicker
            selected={profile.likedTags}
            counts={counts}
            max={MAX_LIKED_TAGS}
            label="Tags you like"
            onChange={(likedTags) => void save({ likedTags }, "likedTags")}
          />
        </div>
        {errors.likedTags && (
          <p role="alert" className="px-1 text-body-sm text-danger">
            {errors.likedTags}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-caption text-muted" aria-live="polite">
          {errors.clear ?? status ?? "Saves as you go."}
        </p>
        {cleared ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const back = cleared;
              setCleared(null);
              void save(back, "clear");
            }}
          >
            Cleared · Undo
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void clearAll()}>
            Clear profile
          </Button>
        )}
      </div>
    </div>
  );
}

const TEXT_LABELS: Record<
  TextField,
  { label: string; placeholder: string; autoComplete: string }
> = {
  displayName: {
    label: "Display name",
    placeholder: "Shown on topics you make public",
    autoComplete: "nickname",
  },
  location: {
    label: "Where you live",
    placeholder: "City or area",
    autoComplete: "address-level2",
  },
  role: {
    label: "What you do",
    placeholder: "Nurse, developer, retired…",
    autoComplete: "organization-title",
  },
};

function TextRow({
  field,
  value,
  error,
  onSave,
}: {
  field: TextField;
  value: string;
  error: string | null;
  onSave: (value: string) => void;
}) {
  const [text, setText] = React.useState(value);
  const id = `profile-${field}`;
  const { label, placeholder, autoComplete } = TEXT_LABELS[field];
  React.useEffect(() => {
    // A cleared or reloaded profile replaces what's shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from saved value
    setText(value);
  }, [value]);
  const commit = () => {
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <label htmlFor={id} className="text-body-sm text-primary">
        {label}
      </label>
      <input
        id={id}
        value={text}
        maxLength={60}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setText(value);
        }}
        className="min-h-11 w-full rounded-[12px] border border-border-strong bg-surface px-3 text-base text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:text-body-sm"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
