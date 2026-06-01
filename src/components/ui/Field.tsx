import * as React from "react";

export type FieldValidateOn = "blur" | "change" | "submit";

type Common = {
  label: React.ReactNode;
  helper?: React.ReactNode;
  /** Externally-controlled error. If omitted, derived from `validate`. */
  error?: React.ReactNode;
  /** Helper rendered in success tone when valid + touched + non-empty. */
  successHint?: React.ReactNode;
  id?: string;
  /** Pure validator. Returns null when valid, or a short message. */
  validate?: (value: string) => string | null;
  /** When to evaluate `validate`. Defaults to `blur`. */
  validateOn?: FieldValidateOn;
  /** Called whenever the underlying validation result changes. */
  onValidityChange?: (error: string | null) => void;
  /** Set true on submit to surface previously-suppressed errors. */
  showSubmitErrors?: boolean;
};

type InputProps = Common &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
    as?: "input";
  };

type TextareaProps = Common &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
    as: "textarea";
  };

export type FieldProps = InputProps | TextareaProps;

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
  const {
    label,
    helper,
    error: errorProp,
    successHint,
    id: providedId,
    validate,
    validateOn = "blur",
    onValidityChange,
    showSubmitErrors,
    ...rest
  } = props;

  const id = useFieldId(providedId);
  const isTextarea = (props as TextareaProps).as === "textarea";

  const [touched, setTouched] = React.useState(false);
  // Whether the user has started typing in this field. Gates `validateOn="change"`
  // so a required field never surfaces its error on a pristine, untouched load
  // (premature-validation antipattern) — only once the user actually interacts.
  const [dirty, setDirty] = React.useState(false);
  const value = (rest as { value?: string }).value ?? "";
  const valueStr = String(value);

  const computedError = React.useMemo(
    () => (validate ? validate(valueStr) : null),
    [validate, valueStr],
  );

  const lastReportedRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (lastReportedRef.current !== computedError) {
      lastReportedRef.current = computedError;
      onValidityChange?.(computedError);
    }
  }, [computedError, onValidityChange]);

  const surface =
    showSubmitErrors || touched || (validateOn === "change" && dirty);
  const derivedError = surface ? computedError : null;
  const error = errorProp ?? derivedError;
  const invalid = Boolean(error);

  const showSuccess =
    !invalid && touched && Boolean(successHint) && valueStr.length > 0;

  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [helperId, errorId].filter(Boolean).join(" ") || undefined;
  const borderClass = invalid
    ? "border-danger-border"
    : showSuccess
      ? "border-success-border"
      : "border-border-strong";

  const {
    as: _as,
    className = "",
    onBlur: onBlurProp,
    onChange: onChangeProp,
    ...controlRest
  } = rest as {
    as?: string;
    className?: string;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
    onChange?: React.ChangeEventHandler<
      HTMLInputElement | HTMLTextAreaElement
    >;
  } & Record<string, unknown>;
  void _as;

  function handleBlur(
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (!touched) setTouched(true);
    (
      onBlurProp as
        | React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>
        | undefined
    )?.(e);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (!dirty) setDirty(true);
    (
      onChangeProp as
        | React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>
        | undefined
    )?.(e);
  }

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
          onBlur={handleBlur}
          onChange={handleChange}
          className={`${controlBase} ${borderClass} min-h-32 ${className}`}
          {...(controlRest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onBlur={handleBlur}
          onChange={handleChange}
          className={`${controlBase} ${borderClass} ${className}`}
          {...(controlRest as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error ? (
        <span id={errorId} className="text-caption text-danger">
          {error}
        </span>
      ) : showSuccess ? (
        <span id={helperId} className="text-caption text-success">
          {successHint}
        </span>
      ) : helper ? (
        <span id={helperId} className="text-caption text-muted">
          {helper}
        </span>
      ) : null}
    </div>
  );
}
