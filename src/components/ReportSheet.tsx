"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { HostedError, type HostedData } from "@/lib/hosted";

// Reporting a public or link-shared topic: a quiet "Report" opens this sheet
// with a reason, then it confirms in place. Signed-in readers only; the
// database takes one report per reader and topic.

export const REPORT_REASONS = [
  "Misleading or false",
  "Hateful or harassing",
  "Spam or ads",
  "Something else",
] as const;

type Step =
  | { kind: "form"; error: string | null }
  | { kind: "sending" }
  | { kind: "sent" };

export function ReportSheet({
  data,
  interestId,
  topic,
  open,
  onClose,
}: {
  data: Pick<HostedData, "report">;
  interestId: string;
  topic: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = React.useState("");
  const [step, setStep] = React.useState<Step>({ kind: "form", error: null });
  const detailId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    // A fresh form each time the sheet opens.
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setStep({ kind: "form", error: null });
    setReason(REPORT_REASONS[0]);
    setDetail("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function send() {
    setStep({ kind: "sending" });
    const text = detail.trim() ? `${reason}: ${detail.trim()}` : reason;
    try {
      await data.report(interestId, text.slice(0, 500));
      setStep({ kind: "sent" });
    } catch (err) {
      setStep({
        kind: "form",
        error:
          err instanceof HostedError
            ? err.message
            : "Couldn't send the report. Try again.",
      });
    }
  }

  if (step.kind === "sent")
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Report sent"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p>
          Thanks. Scout’s team will look at “{topic}”. The owner isn’t told who
          sent it.
        </p>
      </Sheet>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Report “${topic}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={step.kind === "sending"} onClick={() => void send()}>
            Send report
          </Button>
        </>
      }
    >
      <p>
        Scout’s team looks at every report. The owner isn’t told who sent it.
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Why are you reporting it?</legend>
        {REPORT_REASONS.map((r) => (
          <label
            key={r}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-2 text-body-sm text-primary hover:bg-surface-muted"
          >
            <input
              type="radio"
              name="report-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="size-4 accent-[var(--accent-bg)]"
            />
            {r}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={detailId} className="text-body-sm text-secondary">
          More detail (optional)
        </label>
        <textarea
          id={detailId}
          rows={2}
          maxLength={400}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="w-full rounded-[12px] border border-border-strong bg-surface px-3 py-2 text-base text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:text-body-sm"
        />
      </div>
      {step.kind === "form" && step.error && (
        <p role="alert" className="text-body-sm text-danger">
          {step.error}
        </p>
      )}
    </Sheet>
  );
}

/** The quiet link that opens the report sheet. */
export function ReportLink({
  data,
  interestId,
  topic,
  label = "Report",
}: {
  data: Pick<HostedData, "report">;
  interestId: string;
  topic: string;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label === "Report" ? `Report ${topic}` : undefined}
        className="-my-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-caption text-muted underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {label}
      </button>
      <ReportSheet
        data={data}
        interestId={interestId}
        topic={topic}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
