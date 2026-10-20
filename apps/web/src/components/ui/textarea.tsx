import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { useFieldControl } from "../forms/field-context";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  const field = useFieldControl(props.id, props["aria-describedby"]);
  return (
    <textarea
      data-slot="textarea"
      className={cn("ui-textarea", className)}
      {...field}
      {...props}
      required={field.required || props.required}
      aria-describedby={field["aria-describedby"] ?? props["aria-describedby"]}
      aria-invalid={field["aria-invalid"] || props["aria-invalid"]}
    />
  );
}
