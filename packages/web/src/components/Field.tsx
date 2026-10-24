import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  id?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

export function Field({
  className = "",
  error,
  hint,
  id: providedId,
  label,
  ...inputProps
}: FieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [inputProps["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  const classes = ["form-field", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? true : inputProps["aria-invalid"]}
        id={id}
      />
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
