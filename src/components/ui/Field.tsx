import * as React from "react";

type Common = {
  label: React.ReactNode;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  id?: string;
};

type InputProps = Common &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
    as?: "input";
  };

type TextareaProps = Common &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
    as: "textarea";
  };

type FieldProps = InputProps | TextareaProps;

const controlBase =
  "w-full rounded-md border bg-surface px-3 py-2 text-body-sm text-primary shadow-sm outline-none transition " +
  "placeholder:text-muted " +
  "focus:border-focus-ring focus:ring-1 focus:ring-focus-ring " +
  "disabled:opacity-60";

let idCounter = 0;
function useFieldId(provided?: string) {
  const [generated] = React.useState(() => {
    idCounter += 1;
    return `f-${idCounter}`;
  });
  return provided ?? generated;
}

export function Field(props: FieldProps) {
  const { label, helper, error, id: providedId, ...rest } = props;
  const id = useFieldId(providedId);
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error);
  const borderClass = invalid ? "border-danger-border" : "border-border-strong";

  const isTextarea = (props as TextareaProps).as === "textarea";
  const { as: _as, className = "", ...controlRest } = rest as {
    as?: string;
    className?: string;
  } & Record<string, unknown>;
  void _as;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-primary">
        {label}
      </label>
      {isTextarea ? (
        <textarea
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${controlBase} ${borderClass} min-h-32 ${className}`}
          {...(controlRest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${controlBase} ${borderClass} ${className}`}
          {...(controlRest as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {helper && !error && (
        <span id={helperId} className="text-caption text-muted">
          {helper}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-caption text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
