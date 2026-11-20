"use client";

import * as React from "react";
import { MAX_TAGS } from "@scout/core";
import { TagPicker, useTagCounts } from "@/components/TagPicker";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import {
  HostedError,
  shareUrl,
  type HostedData,
  type HostedInterest,
  type Visibility,
} from "@/lib/hosted";
import {
  checkAndPublish,
  hasPublicRoom,
  type PublishState,
} from "@/lib/publish-flow";

// "Who can see it" for one of the reader's own topics: Private, Link only or
// Public. Private and Link only apply at once; Public goes through Scout's
// publish check in a sheet (ask, checking, published with tags, or refused
// with its reason). A public topic's tags are edited here, at most five.
// Its own component so any topic page can mount it.

const OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "private", label: "Private", hint: "Only you see it." },
  {
    value: "shared",
    label: "Link only",
    hint: "Anyone with the link can read and follow it. It isn't in Browse.",
  },
  {
    value: "public",
    label: "Public",
    hint: "Anyone can find it in Browse and follow it for free.",
  },
];

export function SharingSection({
  data,
  interest,
  publicUsed,
  publicLimit,
  onChanged,
  onSignedOut,
  onEdit,
}: {
  data: HostedData;
  interest: HostedInterest;
  /** The reader's public topics, this one included when it is public. */
  publicUsed: number;
  publicLimit: number;
  /** Reload after a change. */
  onChanged: () => Promise<void>;
  /** True when it handled a signed-out error. */
  onSignedOut: (err: unknown) => boolean;
  /** "Edit what it looks for" after a refusal. */
  onEdit?: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<PublishState | null>(null);
  const counts = useTagCounts(data);
  const current = interest.visibility;
  const groupId = React.useId();

  async function setVisibility(v: Exclude<Visibility, "public">) {
    setBusy(true);
    setError(null);
    try {
      await data.setVisibility(interest.id, v);
      await onChanged();
    } catch (err) {
      if (!onSignedOut(err))
        setError(
          err instanceof HostedError
            ? err.message
            : "Couldn't change that. Try again.",
        );
    } finally {
      setBusy(false);
    }
  }

  function choose(v: Visibility) {
    if (v === current || busy) return;
    if (v === "public") setSheet({ kind: "ask" });
    else void setVisibility(v);
  }

  const hint = OPTIONS.find((o) => o.value === current)?.hint ?? "";

  return (
    <div className="flex flex-col gap-3" data-sharing>
      <p id={groupId} className="text-body-sm font-medium text-primary">
        Who can see it
      </p>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="grid grid-cols-3 gap-1 rounded-[12px] bg-surface-muted p-1"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={current === o.value}
            disabled={busy}
            onClick={() => choose(o.value)}
            className={`min-h-9 rounded-[9px] px-2 text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11 ${
              current === o.value
                ? "bg-surface font-medium text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-body-sm text-muted" aria-live="polite">
        {busy ? "Saving…" : hint}
      </p>

      {current !== "private" && interest.shareSlug && (
        <LinkBox slug={interest.shareSlug} />
      )}

      {current === "public" && (
        <TopicTags
          data={data}
          interest={interest}
          counts={counts}
          onSignedOut={onSignedOut}
        />
      )}

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-caption text-muted tabular-nums">
        Public topics: {publicUsed} of {publicLimit} used.
      </p>

      <PublishSheet
        state={sheet}
        topic={interest.topic}
        full={!hasPublicRoom(publicUsed, publicLimit)}
        limit={publicLimit}
        counts={counts}
        onPublish={() => {
          setSheet({ kind: "checking" });
          checkAndPublish(data, interest.id)
            .then(setSheet)
            .catch((err: unknown) => {
              setSheet(null);
              onSignedOut(err);
            });
        }}
        onTags={(tags) => data.setTags(interest.id, tags)}
        onShareByLink={() => {
          setSheet(null);
          void setVisibility("shared");
        }}
        onEdit={
          onEdit &&
          (() => {
            setSheet(null);
            onEdit();
          })
        }
        onClose={() => {
          const published = sheet?.kind === "public";
          setSheet(null);
          if (published) void onChanged();
        }}
      />
    </div>
  );
}

/** The share link with a Copy button. */
export function LinkBox({ slug }: { slug: string }) {
  const url = shareUrl(slug);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-surface-muted py-1 pl-3 pr-1">
      <span className="min-w-0 flex-1 truncate text-body-sm text-secondary">
        {url.replace(/^https?:\/\//, "")}
      </span>
      <CopyButton text={url} />
    </div>
  );
}

export function CopyButton({
  text,
  label = "Copy",
  variant = "ghost",
}: {
  text: string;
  label?: string;
  variant?: "ghost" | "secondary";
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant={variant}
      size="sm"
      className="min-w-20"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => window.prompt("Copy this link", text));
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

/** A public topic's tags, saved as they change. */
function TopicTags({
  data,
  interest,
  counts,
  onSignedOut,
}: {
  data: HostedData;
  interest: HostedInterest;
  counts: { tag: string; topics: number }[];
  onSignedOut: (err: unknown) => boolean;
}) {
  const [tags, setTags] = React.useState(interest.tags);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const save = useTagSaver((t) => data.setTags(interest.id, t), {
    onSaved: (clean) => setTags(clean),
    onStatus: setStatus,
    onSignedOut,
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-secondary">
        People find it by these. Scout made them when it went public.
        <SaveNote status={status} />
      </p>
      <TagPicker
        selected={tags}
        counts={counts}
        max={MAX_TAGS}
        label={`Tags for ${interest.topic}`}
        onChange={(next) => {
          setTags(next);
          save(next);
        }}
      />
    </div>
  );
}

function SaveNote({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <span
      aria-live="polite"
      className={`ml-2 ${status === "failed" ? "text-danger" : "text-muted"}`}
    >
      {status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved"
          : "Couldn't save. Change a tag to try again."}
    </span>
  );
}

/** Sends the newest tags; a send still running is followed by the latest. */
function useTagSaver(
  send: (tags: string[]) => Promise<string[]>,
  opts: {
    onSaved: (clean: string[]) => void;
    onStatus: (s: SaveStatus) => void;
    onSignedOut?: (err: unknown) => boolean;
  },
) {
  const pending = React.useRef<string[] | null>(null);
  const running = React.useRef(false);
  const latest = React.useRef({ send, opts });
  React.useEffect(() => {
    latest.current = { send, opts };
  });

  return React.useCallback((tags: string[]) => {
    pending.current = tags;
    if (running.current) return;
    running.current = true;
    latest.current.opts.onStatus("saving");
    void (async () => {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        try {
          const clean = await latest.current.send(next);
          if (!pending.current) {
            latest.current.opts.onSaved(clean);
            latest.current.opts.onStatus("saved");
          }
        } catch (err) {
          if (!latest.current.opts.onSignedOut?.(err))
            latest.current.opts.onStatus("failed");
        }
      }
      running.current = false;
    })();
  }, []);
}

/** The publish sheet: ask, checking, published (tags), refused, limit. */
export function PublishSheet({
  state,
  topic,
  full,
  limit,
  counts,
  onPublish,
  onTags,
  onShareByLink,
  onEdit,
  onClose,
}: {
  state: PublishState | null;
  topic: string;
  full: boolean;
  limit: number;
  counts: { tag: string; topics: number }[];
  onPublish: () => void;
  onTags: (tags: string[]) => Promise<string[]>;
  onShareByLink: () => void;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const s = state ?? { kind: "ask" as const };
  const title =
    s.kind === "ask"
      ? `Make “${topic}” public?`
      : s.kind === "checking"
        ? "Checking…"
        : s.kind === "public"
          ? "✓ Published"
          : s.kind === "refused"
            ? "Not published"
            : s.kind === "limit"
              ? "No room for another public topic"
              : "Couldn't publish";

  const footer =
    s.kind === "ask" ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={full} onClick={onPublish}>
          Check and publish
        </Button>
      </>
    ) : s.kind === "checking" ? (
      <Button loading disabled>
        Checking
      </Button>
    ) : s.kind === "public" ? (
      <>
        <CopyButton
          text={shareUrl(s.slug)}
          label="Copy link"
          variant="secondary"
        />
        <Button onClick={onClose}>Done</Button>
      </>
    ) : s.kind === "refused" ? (
      <>
        <Button variant="secondary" onClick={onShareByLink}>
          Share by link
        </Button>
        {onEdit ? (
          <Button onClick={onEdit}>Edit what it looks for</Button>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )}
      </>
    ) : s.kind === "failed" ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onPublish}>Try again</Button>
      </>
    ) : (
      <Button onClick={onClose}>Done</Button>
    );

  return (
    <Sheet
      open={state !== null}
      onClose={s.kind === "checking" ? () => {} : onClose}
      title={title}
      footer={footer}
    >
      {s.kind === "ask" &&
        (full ? (
          <p>
            You have {limit} public topics, the most. Make one private first.
          </p>
        ) : (
          <p>
            Anyone can find it in Browse and follow it for free. First Scout
            checks it’s fit to be public and picks tags people can find it by.
          </p>
        ))}
      {s.kind === "checking" && (
        <p aria-live="polite">
          Scout is reading what it looks for. A few seconds.
        </p>
      )}
      {s.kind === "public" && (
        <PublishedTags
          topic={topic}
          initial={s.tags}
          counts={counts}
          onTags={onTags}
        />
      )}
      {s.kind === "refused" && (
        <>
          <div className="rounded-[12px] bg-surface-muted p-3">
            <p className="text-caption text-muted">Scout’s reason</p>
            <p className="text-body-sm text-primary">{s.reason}</p>
          </div>
          <p>
            It stays private. Change what it looks for and try again, or share
            it by link.
          </p>
        </>
      )}
      {(s.kind === "limit" || s.kind === "failed") && (
        <p role="alert">{s.message}</p>
      )}
    </Sheet>
  );
}

function PublishedTags({
  topic,
  initial,
  counts,
  onTags,
}: {
  topic: string;
  initial: string[];
  counts: { tag: string; topics: number }[];
  onTags: (tags: string[]) => Promise<string[]>;
}) {
  const [tags, setTags] = React.useState(initial);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const save = useTagSaver(onTags, {
    onSaved: setTags,
    onStatus: setStatus,
  });
  return (
    <>
      <p>
        “{topic}” is in Browse now. Scout tagged it so people can find it;
        change the tags any time.
        <SaveNote status={status} />
      </p>
      <TagPicker
        selected={tags}
        counts={counts}
        max={MAX_TAGS}
        label={`Tags for ${topic}`}
        onChange={(next) => {
          setTags(next);
          save(next);
        }}
      />
    </>
  );
}
