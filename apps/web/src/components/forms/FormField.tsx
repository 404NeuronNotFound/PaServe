import type { ComponentProps, ReactNode } from "react";
import { InlineMessage } from "../feedback/InlineMessage";
import { cn } from "../../lib/utils";
import { FieldContext } from "./field-context";

/** One editable control per field; compound controls may wrap that input. */
export function FormField({
  id,
  label,
  hint,
  error,
  errorId = `${id}-error`,
  hintId = `${id}-hint`,
  required = false,
  optional = false,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  errorId?: string;
  hintId?: string;
  required?: boolean;
  optional?: boolean;
}) {
  const describedBy = [hint ? hintId : "", error ? errorId : ""]
    .filter(Boolean).join(" ") || undefined;
  const hasRequiredLabel = typeof label === "string" && label.includes("(required)");
  return (
    <FieldContext value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div
        className={cn("field form-field", className)}
        data-required={required && !hasRequiredLabel || undefined}
        data-optional={optional && !required || undefined}
        {...props}
      >
        <label htmlFor={id}>{label}</label>
        {children}
        {hint && <p className="field-hint" id={hintId}>{hint}</p>}
        {error && <InlineMessage className="field-error" id={errorId}>{error}</InlineMessage>}
      </div>
    </FieldContext>
  );
}
